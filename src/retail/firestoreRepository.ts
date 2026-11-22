import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {RetailRepository,RetailTransaction,Scope,RetailCatalog,RetailOrder,Stock,Receipt} from './model';
import type {CapabilityAssignment} from '../capabilities/model';
import type {BusinessProfileRevision} from '../business/model';
import type {Subscription} from '../plans/model';
import {planAllows} from './plan';
import {reject} from '../scheduling/rules';
const key=(...x:string[])=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export class FirestoreRetailRepository implements RetailRepository{
 async transact<T>(s:Scope,work:(tx:RetailTransaction)=>Promise<T>){
  const db=getFirestore(ensureFirebaseAdminApp()),scope=key(s.tenantId,s.unitId),unit=db.collection('retailUnits').doc(scope);
  const catalog=unit.collection('catalog').doc('current'),orders=unit.collection('orders'),stocks=unit.collection('stock'),receipts=unit.collection('receipts');
  return db.runTransaction(async trx=>{
   const fence=await trx.get(unit);
   if(fence.exists&&(fence.get('tenantId')!==s.tenantId||fence.get('unitId')!==s.unitId))return reject('RETAIL_SCOPE_CORRUPT','INTERNAL');
   const writes:Array<()=>void>=[];
   function check<T extends Scope>(x:T|undefined):T|null{if(x&&(x.tenantId!==s.tenantId||x.unitId!==s.unitId))return reject('RETAIL_SCOPE_CORRUPT','INTERNAL');return x??null;}
   const port:RetailTransaction={
    grant:async(caps,now,native,feature)=>{
     const p=await trx.get(db.collection('businessProfiles').doc(scope)),a=await trx.get(db.collection('unitCapabilityAssignments').doc(scope));
     const sub=(await trx.get(db.collection('subscriptions').doc(s.tenantId))).data() as Subscription|undefined;
     if(!planAllows(sub,s.tenantId,now)||feature&&!planAllows(sub,s.tenantId,now,feature)||!p.exists||!a.exists||
       p.get('tenantId')!==s.tenantId||p.get('unitId')!==s.unitId||a.get('tenantId')!==s.tenantId||a.get('unitId')!==s.unitId)return false;
     const asOf=new Date(now).toISOString();
     const profile=check((await trx.get(p.ref.collection('versions').where('effectiveFrom','<=',asOf).orderBy('effectiveFrom','desc').limit(1))).docs[0]?.data() as BusinessProfileRevision|undefined);
     const assignment=check((await trx.get(a.ref.collection('versions').doc(String(a.get('latestVersion'))))).data() as CapabilityAssignment|undefined);
     return !!profile&&!!assignment&&(!profile.expiresAt||profile.expiresAt>asOf)&&profile.capabilityRegistry.vertical==='RETAIL'&&
      assignment.vertical==='RETAIL'&&assignment.templateId==='RETAIL_STD'&&assignment.state==='ENABLED_INTERNAL'&&
      assignment.schemaVersion===1&&assignment.templateVersion===1&&assignment.version===a.get('latestVersion')&&
      assignment.operationMode===profile.capabilityRegistry.operationMode&&(!native||assignment.operationMode==='NATIVE_OPERATIONS')&&
      caps.every(c=>assignment.enabledCapabilities.includes(c));
    },
    catalog:async()=>check((await trx.get(catalog)).data() as RetailCatalog|undefined),
    stock:async(i)=>{const x=check((await trx.get(stocks.doc(i))).data() as (Stock&Scope)|undefined);if(!x)return null;const {tenantId:_t,unitId:_u,...rest}=x;return rest;},
    order:async(i)=>{const x=check((await trx.get(orders.doc(i))).data() as RetailOrder|undefined);if(x&&x.id!==i)return reject('RETAIL_SCOPE_CORRUPT','INTERNAL');return x;},
    receipt:async(k)=>{const x=check((await trx.get(receipts.doc(key(k)))).data() as (Receipt&Scope)|undefined);return x?{fingerprint:x.fingerprint,orderId:x.orderId}:null;},
    active:async()=>Number(fence.get('activeOrders')??0)>0,
    orders:async(start,end)=>{
     const rows=await trx.get(orders.where('createdAt','>=',start).where('createdAt','<',end).limit(1001));
     if(rows.size>1000)return reject('RETAIL_REPORT_CAPACITY','CONFLICT');
     return rows.docs.map(d=>check(d.data() as RetailOrder)!);
    },
    saveCatalog:c=>{writes.push(()=>{trx.set(catalog,c);trx.create(unit.collection('catalogVersions').doc(String(c.version)),c);});},
    saveStock:r=>{writes.push(()=>trx.set(stocks.doc(r.itemId),{...s,...r}));},
    saveOrder:o=>{writes.push(()=>{trx.set(orders.doc(o.id),o);trx.create(orders.doc(o.id).collection('versions').doc(String(o.version)),o);});},
    saveReceipt:(k,r)=>{writes.push(()=>trx.create(receipts.doc(key(k)),{...s,...r}));},
    saveMovement:(i,r)=>{writes.push(()=>trx.create(unit.collection('movements').doc(key(i)),{...s,...r}));}
   };
   // Derive active count from transitions, atomically with the stock ledger.
   const original=port.saveOrder;let staged:RetailOrder|undefined;
   port.saveOrder=o=>{if(staged)return reject('RETAIL_MULTIPLE_ORDER_WRITES','INTERNAL');staged=o;original(o);};
   const result=await work(port);
   if(writes.length){
    let count=Number(fence.get('activeOrders')??0);
    if(!Number.isSafeInteger(count)||count<0)return reject('RETAIL_ACTIVE_COUNT_CORRUPT','INTERNAL');
    if(staged){
     const before=await port.order(staged.id);
     count+=Number(staged.status==='CONFIRMED')-Number(before?.status==='CONFIRMED');
    }
    if(count<0)return reject('RETAIL_ACTIVE_COUNT_CORRUPT','INTERNAL');
    trx.set(unit,{...s,activeOrders:count,sequence:Number(fence.get('sequence')??0)+1});
    for(const write of writes)write();
   }
   return result;
  });
 }
}
