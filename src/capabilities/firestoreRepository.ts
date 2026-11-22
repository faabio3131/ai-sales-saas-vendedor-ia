import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {ApplicationError} from '../infrastructure/errors';
import type {CapabilityRepository,CapabilityAssignment} from './model';
import {blocksActiveFoodOperations} from './operationalState';

const db=()=>getFirestore(ensureFirebaseAdminApp());
function key(...pieces:string[]){
 return createHash('sha256').update(JSON.stringify(pieces)).digest('hex');
}
function failure(code:string):never{
 throw new ApplicationError({category:'CONFLICT',code,message:'Capability assignment changed or has invalid scope.'});
}
/**
 * One pointer per tenant/unit, append-only immutable revisions and CAS.
 * Unit isolation is enforced again on each read, including revisions.
 */
export class FirestoreCapabilityRepository implements CapabilityRepository {
 private ref(t:string,u:string){return db().collection('unitCapabilityAssignments').doc(key(t,u));}
 async latest(t:string,u:string):Promise<CapabilityAssignment|null>{
  const pointer=await this.ref(t,u).get();
  if(!pointer.exists)return null;
  if(pointer.get('tenantId')!==t||pointer.get('unitId')!==u)return null;
  const version=pointer.get('latestVersion');
  if(!Number.isSafeInteger(version)||version<1)return null;
  return this.version(t,u,version);
 }
 async version(t:string,u:string,version:number):Promise<CapabilityAssignment|null>{
  if(!Number.isSafeInteger(version)||version<1)return null;
  const row=await this.ref(t,u).collection('versions').doc(String(version)).get();
  const data=row.data() as CapabilityAssignment|undefined;
  return data?.tenantId===t&&data.unitId===u&&data.version===version&&
   data.schemaVersion===1?data:null;
 }
 async publish(next:CapabilityAssignment,expectedVersion:number):Promise<void>{
  const ref=this.ref(next.tenantId,next.unitId);
  await db().runTransaction(async tx=>{
   const pointer=await tx.get(ref);
   if(pointer.exists&&(pointer.get('tenantId')!==next.tenantId||
     pointer.get('unitId')!==next.unitId))failure('CAPABILITY_SCOPE_CONFLICT');
   const version=pointer.exists?pointer.get('latestVersion'):0;
   if(!Number.isSafeInteger(version)||version!==expectedVersion||
      next.version!==expectedVersion+1)failure('CAPABILITY_VERSION_CONFLICT');
   // Profile pointer participates in same transaction. If an owner publishes
   // a concurrent profile change, the assignment cannot silently rebind.
   const profileRef=db().collection('businessProfiles').doc(key(next.tenantId,next.unitId));
   const profile=await tx.get(profileRef);
   if(!profile.exists||profile.get('tenantId')!==next.tenantId||
      profile.get('unitId')!==next.unitId||
      profile.get('latestVersion')!==next.profileVersion)
     failure('CAPABILITY_PROFILE_VERSION_CHANGED');
   const previousVersion=pointer.exists?pointer.get('latestVersion'):0;
   const priorDoc=previousVersion>0?
    await tx.get(ref.collection('versions').doc(String(previousVersion))):null;
   const previous=priorDoc?.data() as CapabilityAssignment|undefined;
   if(previous&&(previous.tenantId!==next.tenantId||previous.unitId!==next.unitId))
    failure('CAPABILITY_SCOPE_CONFLICT');
   // A profile/assignment migration must serialize with the canonical
   // order database; without this read an old KDS can disappear mid-service.
   if(blocksActiveFoodOperations(previous,next)){
    const open=await tx.get(db().collection('orders')
     .where('tenantId','==',next.tenantId).where('unitId','==',next.unitId)
     .where('status','==','CONFIRMED').limit(201));
    if(open.size>200||open.docs.some(d=>d.get('productionState')!=='COMPLETED'))
     failure('CAPABILITY_ACTIVE_ORDERS_BLOCK_CHANGE');
   }
   if(previous?.enabledCapabilities.includes('SCHEDULING')&&
     (!next.enabledCapabilities.includes('SCHEDULING')||
      !next.enabledCapabilities.includes('SERVICE_CATALOG')||
      previous.enabledCapabilities.some(x=>['SERVICE_BOOKING','BEAUTY_SERVICES','BEAUTY_BOOKING','HEALTH_ADMIN'].includes(x)&&!next.enabledCapabilities.includes(x))||previous.vertical!==next.vertical||
      previous.operationMode!==next.operationMode)){
    const now=Date.now();
    await tx.get(db().collection('schedulingTenants').doc(key(next.tenantId)));
    const pending=await tx.get(db().collection('schedulingUnits').doc(key(next.tenantId,next.unitId))
      .collection('bookings').where('endMs','>',now).limit(1001));
    if(pending.size>1000||pending.docs.some(d=>d.get('status')==='CONFIRMED'||
     d.get('status')==='HELD'&&Number(d.get('holdUntilMs'))>now))
      failure('CAPABILITY_ACTIVE_BOOKINGS_BLOCK_CHANGE');
   }
   if(previous?.vertical==='RETAIL'&&(next.vertical!=='RETAIL'||previous.operationMode!==next.operationMode||
    previous.enabledCapabilities.some(c=>c.startsWith('RETAIL_')&&!next.enabledCapabilities.includes(c)))){
    const retail=await tx.get(db().collection('retailUnits').doc(key(next.tenantId,next.unitId)));
    if(Number(retail.get('activeOrders')??0)>0)failure('CAPABILITY_ACTIVE_RETAIL_ORDERS_BLOCK_CHANGE');
   }
   const item=ref.collection('versions').doc(String(next.version));
   tx.create(item,next);
   tx.set(ref,{tenantId:next.tenantId,unitId:next.unitId,
    latestVersion:next.version,updatedAt:next.createdAt});
  });
 }
}
