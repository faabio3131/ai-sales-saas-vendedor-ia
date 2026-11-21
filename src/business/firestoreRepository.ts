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
  async delete(tenantId:string,unitId:string,customerId:string):Promise<void>{
    const ref=memoryDoc(tenantId,unitId,customerId);
    await db().runTransaction(async tx=>{
      const snap=await tx.get(ref);
      const record=snap.data() as ScopedCustomerMemory|undefined;
      if(record&&(record.tenantId!==tenantId||record.unitId!==unitId||record.customerId!==customerId))
        conflict('MEMORY_SCOPE_CONFLICT');
      if(snap.exists)tx.delete(ref);
    });
  }
  async purgeExpired(asOf:string,limit=100):Promise<number>{
    const batch=await db().collection('scopedCustomerMemories')
      .where('expiresAt','<=',asOf).limit(Math.max(1,Math.min(200,limit))).get();
    if(batch.empty)return 0;
    const write=db().batch();
    batch.docs.forEach(d=>write.delete(d.ref));
    await write.commit();
    return batch.size;
  }
}
