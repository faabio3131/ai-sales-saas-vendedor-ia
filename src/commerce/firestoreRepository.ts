import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { catalogError } from './service';
import type { UnitCatalogRepository,UnitCatalogRevision } from './model';

const db=()=>getFirestore(ensureFirebaseAdminApp());
const scopeKey=(tenant:string,unit:string)=>createHash('sha256')
  .update(JSON.stringify([tenant,unit])).digest('hex');
const root=(tenant:string,unit:string)=>db().collection('unitCommerceCatalogs')
  .doc(scopeKey(tenant,unit));
export class FirestoreUnitCatalogRepository implements UnitCatalogRepository {
  async latest(tenant:string,unit:string):Promise<UnitCatalogRevision|null>{
    const doc=root(tenant,unit);
    const pointer=await doc.get();
    if(!pointer.exists||pointer.get('tenantId')!==tenant||pointer.get('unitId')!==unit)return null;
    const rev=await doc.collection('versions').doc(String(pointer.get('latestVersion'))).get();
    const value=rev.data() as UnitCatalogRevision|undefined;
    return value?.tenantId===tenant&&value.unitId===unit?value:null;
  }
  async effective(tenant:string,unit:string,asOf:string):Promise<UnitCatalogRevision|null>{
    const doc=root(tenant,unit);
    const pointer=await doc.get();
    if(!pointer.exists||pointer.get('tenantId')!==tenant||pointer.get('unitId')!==unit)return null;
    const candidates=await doc.collection('versions')
      .where('effectiveFrom','<=',asOf).orderBy('effectiveFrom','desc').limit(1).get();
    if(candidates.empty)return null;
    const value=candidates.docs[0].data() as UnitCatalogRevision;
    if(value.tenantId!==tenant||value.unitId!==unit)return null;
    return value.expiresAt&&value.expiresAt<=asOf?null:value;
  }
  async createRevision(revision:UnitCatalogRevision,expectedVersion:number):Promise<void>{
    const doc=root(revision.tenantId,revision.unitId);
    await db().runTransaction(async tx=>{
      const prev=await tx.get(doc);
      if(prev.exists&&(prev.get('tenantId')!==revision.tenantId||
        prev.get('unitId')!==revision.unitId))catalogError('COMMERCE_SCOPE_CONFLICT','CONFLICT');
      const version=prev.exists?Number(prev.get('latestVersion')):0;
      if(version!==expectedVersion||revision.version!==version+1)
        catalogError('COMMERCE_VERSION_CONFLICT','CONFLICT');
      tx.create(doc.collection('versions').doc(String(revision.version)),revision);
      tx.set(doc,{tenantId:revision.tenantId,unitId:revision.unitId,
        latestVersion:revision.version,updatedAt:revision.createdAt});
    });
  }
}
