import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {ScheduleRepository,ScheduleScope,ScheduleTransaction,ScheduleConfig,Booking,Occupancy,RequestReceipt} from './model';
import type {CapabilityAssignment} from '../capabilities/model';
import type {BusinessProfileRevision} from '../business/model';
import {asOccupancy,MAX_DURATION,reject} from './rules';

const hash=(...p:string[])=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
const MAX_ROWS=1000;
export class FirestoreScheduleRepository implements ScheduleRepository{
 async transact<T>(scope:ScheduleScope,work:(tx:ScheduleTransaction)=>Promise<T>):Promise<T>{
  const db=getFirestore(ensureFirebaseAdminApp()),key=hash(scope.tenantId,scope.unitId);
  const tenant=db.collection('schedulingTenants').doc(hash(scope.tenantId));
  const unit=db.collection('schedulingUnits').doc(key);
  const bookings=unit.collection('bookings'),occupancy=tenant.collection('occupancy');
  const receipts=unit.collection('receipts');
  return db.runTransaction(async trx=>{
   // A shared tenant fence serializes resource/professional occupancy across units.
   const fence=await trx.get(tenant),u=await trx.get(unit);
   if(fence.exists&&fence.get('tenantId')!==scope.tenantId)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');
   if(u.exists&&(u.get('tenantId')!==scope.tenantId||u.get('unitId')!==scope.unitId))
    return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');
   const staged=new Map<string,Booking>(),stagedReceipts=new Map<string,RequestReceipt>();
   const config=u.exists?u.get('config') as ScheduleConfig:null;
   if(config&&(config.tenantId!==scope.tenantId||config.unitId!==scope.unitId))
    return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');
   let nextConfig:ScheduleConfig|undefined;
   function checkRow(b:Booking|Occupancy){
    if(b.tenantId!==scope.tenantId)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');
   }
   async function readBooking(id:string){
    const snap=await trx.get(bookings.doc(id));
    if(!snap.exists)return null;
    const row=snap.data() as Booking;checkRow(row);
    if(row.unitId!==scope.unitId||row.id!==id)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');
    return row;
   }
   function bounded<T>(rows:T[]):T[]{
    if(rows.length>MAX_ROWS)return reject('SCHEDULE_WINDOW_CAPACITY','CONFLICT');
    return rows;
   }
   const port:ScheduleTransaction={
    config:async()=>config,
    grant:async(nowMs:number)=>{
     const a=await trx.get(db.collection('unitCapabilityAssignments').doc(key));
     if(!a.exists||a.get('tenantId')!==scope.tenantId||a.get('unitId')!==scope.unitId)return false;
     const v=a.get('latestVersion');
     if(!Number.isSafeInteger(v)||v<1)return false;
     const ar=await trx.get(a.ref.collection('versions').doc(String(v)));
     const assignment=ar.data() as CapabilityAssignment|undefined;
     if(!assignment||assignment.tenantId!==scope.tenantId||assignment.unitId!==scope.unitId||
       assignment.version!==v||assignment.state!=='ENABLED_INTERNAL'||
       assignment.operationMode!=='NATIVE_OPERATIONS'||
       !assignment.enabledCapabilities.includes('SCHEDULING')||
       !assignment.enabledCapabilities.includes('SERVICE_CATALOG'))return false;
     const p=await trx.get(db.collection('businessProfiles').doc(key));
     if(!p.exists||p.get('tenantId')!==scope.tenantId||p.get('unitId')!==scope.unitId)return false;
     const now=new Date(nowMs).toISOString();
     const pr=await trx.get(p.ref.collection('versions').where('effectiveFrom','<=',now)
       .orderBy('effectiveFrom','desc').limit(1));
     const profile=pr.docs[0]?.data() as BusinessProfileRevision|undefined;
     return !!profile&&profile.tenantId===scope.tenantId&&profile.unitId===scope.unitId&&
      (!profile.expiresAt||profile.expiresAt>now)&&
      ['SERVICES','BEAUTY','HEALTH_SERVICE'].includes(profile.capabilityRegistry.vertical)&&
      profile.capabilityRegistry.vertical===assignment.vertical&&
      profile.capabilityRegistry.operationMode===assignment.operationMode;
    },
    booking:readBooking,
    window:async(start,end)=>{
     const snap=await trx.get(occupancy.where('startMs','>=',start-MAX_DURATION)
      .where('startMs','<',end).limit(MAX_ROWS+1));
     return bounded(snap.docs.map(d=>{const x=d.data() as Occupancy;checkRow(x);return x;}));
    },
    records:async(start,end)=>{
     const snap=await trx.get(bookings.where('startMs','>=',start).where('startMs','<',end).limit(MAX_ROWS+1));
     return bounded(snap.docs.map(d=>{const x=d.data() as Booking;checkRow(x);
       if(x.unitId!==scope.unitId)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');return x;}));
    },
    future:async(now)=>{
     const snap=await trx.get(bookings.where('endMs','>',now).limit(MAX_ROWS+1));
     return bounded(snap.docs.map(d=>{const x=d.data() as Booking;checkRow(x);
       if(x.unitId!==scope.unitId)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');return x;}));
    },
    due:async(now)=>{
     const snap=await trx.get(bookings.where('maintenanceDueMs','<=',now).orderBy('maintenanceDueMs').limit(100));
     return snap.docs.map(d=>{const x=d.data() as Booking;checkRow(x);
       if(x.unitId!==scope.unitId)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');return x;});
    },
    receipt:async(k)=>{
     const snap=await trx.get(receipts.doc(hash(k)));
     if(!snap.exists)return null;
     const row=snap.data()!;
     if(row.tenantId!==scope.tenantId||row.unitId!==scope.unitId)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');
     return {fingerprint:row.fingerprint as string,bookingId:row.bookingId as string};
    },
    saveConfig:c=>{nextConfig=c;},
    saveBooking:b=>{staged.set(b.id,b);},
    saveReceipt:(k,r)=>{stagedReceipts.set(k,r);},
   };
   const result=await work(port);
   if(staged.size||stagedReceipts.size||nextConfig){
    trx.set(tenant,{tenantId:scope.tenantId,sequence:Number(fence.get('sequence')??0)+1});
    if(nextConfig){
     trx.set(unit,{...scope,config:nextConfig});
     trx.create(unit.collection('configVersions').doc(String(nextConfig.version)),nextConfig);
    }
    for(const b of staged.values()){
     checkRow(b);
     if(b.unitId!==scope.unitId)return reject('SCHEDULE_SCOPE_CORRUPT','INTERNAL');
     // Persist only one next due timestamp, enabling a bounded indexed worker.
     const {maintenanceDueMs:_old,...rest}=b;
     const due=b.status==='HELD'?b.holdUntilMs:
      b.status==='CONFIRMED'&&b.reminder?.state==='PENDING'?b.reminder.dueMs:
      b.status==='CONFIRMED'&&b.reminder?.state==='READY'?b.startMs:undefined;
     const persisted:Booking=due===undefined?rest:{...rest,maintenanceDueMs:due};
     trx.set(bookings.doc(b.id),persisted);
     trx.create(bookings.doc(b.id).collection('versions').doc(String(b.version)),persisted);
     const lock=asOccupancy(b);
     if(lock)trx.set(occupancy.doc(b.id),lock);else trx.delete(occupancy.doc(b.id));
    }
    for(const [k,r] of stagedReceipts)trx.create(receipts.doc(hash(k)),{...scope,...r});
   }
   return result;
  });
 }
}
