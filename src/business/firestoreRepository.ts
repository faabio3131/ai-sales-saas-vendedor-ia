import { createHash } from 'node:crypto';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { ApplicationError } from '../infrastructure/errors';
import type { BusinessProfileRepository,ScopedMemoryRepository } from './contracts';
import type { BusinessProfileRevision } from './model';
import type { ScopedCustomerMemory } from './memoryModel';

function db():Firestore{return getFirestore(ensureFirebaseAdminApp());}
function key(...pieces:string[]):string {
  // Unambiguous scope key, including delimiter length; never interpolate user IDs into paths.
  return createHash('sha256').update(JSON.stringify(pieces)).digest('hex');
}
function scopeDoc(tenant:string,unit:string){return db().collection('businessProfiles').doc(key(tenant,unit));}
function memoryDoc(tenant:string,unit:string,customer:string){
  return db().collection('scopedCustomerMemories').doc(key(tenant,unit,customer));
}
function conflict(code:string):never {
  throw new ApplicationError({category:'CONFLICT',code,message:'The record changed concurrently.'});
}
export class FirestoreBusinessProfileRepository implements BusinessProfileRepository {
  async latest(tenantId:string,unitId:string):Promise<BusinessProfileRevision|null>{
    const doc=scopeDoc(tenantId,unitId);
    const pointer=await doc.get();
    if(!pointer.exists)return null;
    const data=pointer.data()!;
    if(data.tenantId!==tenantId||data.unitId!==unitId)return null;
    const rev=await doc.collection('versions').doc(String(data.latestVersion)).get();
    const profile=rev.data() as BusinessProfileRevision|undefined;
    return profile?.tenantId===tenantId&&profile.unitId===unitId?profile:null;
  }
  async effective(tenantId:string,unitId:string,asOf:string):Promise<BusinessProfileRevision|null>{
    const doc=scopeDoc(tenantId,unitId);
    const pointer=await doc.get();
    if(!pointer.exists||pointer.get('tenantId')!==tenantId||pointer.get('unitId')!==unitId)return null;
    const snapshots=await doc.collection('versions')
      .where('effectiveFrom','<=',asOf).orderBy('effectiveFrom','desc').limit(1).get();
    if(snapshots.empty)return null;
    const profile=snapshots.docs[0].data() as BusinessProfileRevision;
    if(profile.tenantId!==tenantId||profile.unitId!==unitId)return null;
    // Never revive an older revision after expiry of a newer one.
    return profile.expiresAt&&profile.expiresAt<=asOf?null:profile;
  }
  async createRevision(next:BusinessProfileRevision,expectedVersion:number):Promise<void>{
    const ref=scopeDoc(next.tenantId,next.unitId);
    await db().runTransaction(async tx=>{
      const current=await tx.get(ref);
      if(current.exists&&(current.get('tenantId')!==next.tenantId||current.get('unitId')!==next.unitId))conflict('BUSINESS_SCOPE_CONFLICT');
      const v=current.exists?Number(current.get('latestVersion')):0;
      if(v!==expectedVersion||next.version!==v+1)conflict('BUSINESS_VERSION_CONFLICT');
      if(v>0){
        const currentRevision=(await tx.get(ref.collection('versions').doc(String(v))))
          .data() as BusinessProfileRevision|undefined;
        if(currentRevision&&(
          currentRevision.capabilityRegistry.vertical!==next.capabilityRegistry.vertical||
          currentRevision.capabilityRegistry.operationMode!==next.capabilityRegistry.operationMode||
          currentRevision.policy.timezone!==next.policy.timezone)){
          const retail=await tx.get(db().collection('retailUnits').doc(key(next.tenantId,next.unitId)));
          if(Number(retail.get('activeOrders')??0)>0)conflict('BUSINESS_ACTIVE_RETAIL_ORDERS_BLOCK_CHANGE');
          const now=Date.now();
          await tx.get(db().collection('schedulingTenants').doc(key(next.tenantId)));
          const activeBookings=await tx.get(db().collection('schedulingUnits')
            .doc(key(next.tenantId,next.unitId)).collection('bookings')
            .where('endMs','>',now).limit(1001));
          if(activeBookings.size>1000||activeBookings.docs.some(d=>d.get('status')==='CONFIRMED'||
           d.get('status')==='HELD'&&Number(d.get('holdUntilMs'))>now))
            conflict('BUSINESS_ACTIVE_BOOKINGS_BLOCK_CHANGE');
        }
        if(currentRevision&&(
          currentRevision.capabilityRegistry.operationMode!==next.capabilityRegistry.operationMode||
          currentRevision.capabilityRegistry.vertical!==next.capabilityRegistry.vertical||
          currentRevision.capabilityRegistry.capabilities.some(c=>
            !next.capabilityRegistry.capabilities.includes(c))
        )){
          // Profile changes and production release both read/write Orders.
          // With a transaction this blocks a concurrent mode change during
          // a confirmed, unfinished order. 201+ records: fail closed.
          const pending=await tx.get(db().collection('orders')
            .where('tenantId','==',next.tenantId)
            .where('unitId','==',next.unitId)
            .where('status','==','CONFIRMED').limit(201));
          if(pending.size>200||pending.docs.some(d=>
            d.get('productionState')!=='COMPLETED'))
            conflict('BUSINESS_OPERATION_MODE_ACTIVE_ORDER');
        }
      }
      const nextRef=ref.collection('versions').doc(String(next.version));
      tx.create(nextRef,next);
      tx.set(ref,{tenantId:next.tenantId,unitId:next.unitId,latestVersion:next.version,updatedAt:next.createdAt});
    });
  }
}
export class FirestoreScopedMemoryRepository implements ScopedMemoryRepository {
  async get(tenantId:string,unitId:string,customerId:string):Promise<ScopedCustomerMemory|null>{
    const doc=await memoryDoc(tenantId,unitId,customerId).get();
    const data=doc.data() as ScopedCustomerMemory|undefined;
    return data?.tenantId===tenantId&&data.unitId===unitId&&data.customerId===customerId?data:null;
  }
  async save(next:ScopedCustomerMemory,expectedVersion:number):Promise<void>{
    const ref=memoryDoc(next.tenantId,next.unitId,next.customerId);
    await db().runTransaction(async tx=>{
      const snap=await tx.get(ref);
      const prev=snap.data() as ScopedCustomerMemory|undefined;
      if(prev&&(prev.tenantId!==next.tenantId||prev.unitId!==next.unitId||prev.customerId!==next.customerId))conflict('MEMORY_SCOPE_CONFLICT');
      if((prev?.version??0)!==expectedVersion||next.version!==expectedVersion+1)conflict('MEMORY_VERSION_CONFLICT');
      tx.set(ref,next);
    });
  }
  async delete(tenantId:string,unitId:string,customerId:string,expectedVersion:number):Promise<void>{
    const ref=memoryDoc(tenantId,unitId,customerId);
    await db().runTransaction(async tx=>{
      const snap=await tx.get(ref);
      const record=snap.data() as ScopedCustomerMemory|undefined;
      if(record&&(record.tenantId!==tenantId||record.unitId!==unitId||record.customerId!==customerId))
        conflict('MEMORY_SCOPE_CONFLICT');
      if((record?.version??0)!==expectedVersion)conflict('MEMORY_VERSION_CONFLICT');
      if(snap.exists)tx.delete(ref);
    });
  }
  async purgeExpired(asOf:string,limit=100):Promise<number>{
    const batch=await db().collection('scopedCustomerMemories')
      .where('expiresAt','<=',asOf).limit(Math.max(1,Math.min(200,limit))).get();
    if(batch.empty)return 0;
    let deleted=0;
    for(const found of batch.docs){
      const removed=await db().runTransaction(async tx=>{
        const current=await tx.get(found.ref);
        if(!current.exists||typeof current.get('expiresAt')!=='string'||current.get('expiresAt')>asOf)return false;
        tx.delete(found.ref);
        return true;
      });
      if(removed)deleted++;
    }
    return deleted;
  }
}
