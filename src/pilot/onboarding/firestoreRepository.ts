import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../../infrastructure/firebaseAdmin';
import type {PilotRegistrationRecord,PilotRegistrationRepository} from './model';
import {rejected} from './validation';
function db(){return getFirestore(ensureFirebaseAdminApp());}
function doc(t:string,u:string){
 const id=createHash('sha256').update(JSON.stringify([t,u])).digest('hex');
 return db().collection('pilotOnboarding').doc(id);
}
export class FirestorePilotRegistrationRepository implements PilotRegistrationRepository{
 async latest(t:string,u:string){
  const ref=doc(t,u),snapshot=await ref.get();
  if(!snapshot.exists)return null;
  if(snapshot.get('tenantId')!==t||snapshot.get('unitId')!==u)
   rejected('PILOT_SCOPE_MISMATCH','FORBIDDEN');
  const v=snapshot.get('latestVersion');
  if(!Number.isSafeInteger(v)||v<1)rejected('PILOT_VERSION_CORRUPT','CONFLICT');
  const revision=await ref.collection('versions').doc(String(v)).get();
  const result=revision.data() as PilotRegistrationRecord|undefined;
  if(!result||result.tenantId!==t||result.unitId!==u||result.version!==v)
   rejected('PILOT_REVISION_CORRUPT','CONFLICT');
  return result;
 }
 async save(next:PilotRegistrationRecord,expectedVersion:number){
  const ref=doc(next.tenantId,next.unitId);
  return db().runTransaction(async tx=>{
   const snapshot=await tx.get(ref);
   if(snapshot.exists&&(snapshot.get('tenantId')!==next.tenantId||
     snapshot.get('unitId')!==next.unitId))rejected('PILOT_SCOPE_MISMATCH','FORBIDDEN');
   const version=snapshot.exists?Number(snapshot.get('latestVersion')):0;
   if(version!==expectedVersion||next.version!==expectedVersion+1)
    rejected('PILOT_VERSION_CONFLICT','CONFLICT');
   tx.create(ref.collection('versions').doc(String(next.version)),next);
   tx.set(ref,{tenantId:next.tenantId,unitId:next.unitId,
    latestVersion:next.version,updatedAt:next.updatedAt});
   return next;
  });
 }
}
