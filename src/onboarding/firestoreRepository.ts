import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {OnboardingRecord,OnboardingStore} from './model';
import type {Subscription} from '../plans/model';
import {planAllows} from '../retail/plan';
import {reject} from '../scheduling/rules';
const key=(t:string,u:string)=>createHash('sha256').update(JSON.stringify([t,u])).digest('hex');
export class FirestoreMultiSectorOnboarding implements OnboardingStore{
 async get(t:string,u:string){
  const x=(await getFirestore(ensureFirebaseAdminApp()).collection('multisectorOnboarding').doc(key(t,u)).get()).data() as OnboardingRecord|undefined;
  return x?.tenantId===t&&x.unitId===u?x:null;
 }
 async create(r:OnboardingRecord){
  const db=getFirestore(ensureFirebaseAdminApp()),k=key(r.tenantId,r.unitId),record=db.collection('multisectorOnboarding').doc(k),
   profile=db.collection('businessProfiles').doc(k),assignment=db.collection('unitCapabilityAssignments').doc(k);
  return db.runTransaction(async tx=>{
   const existing=(await tx.get(record)).data() as OnboardingRecord|undefined;
   if(existing){
    if(existing.tenantId!==r.tenantId||existing.unitId!==r.unitId||existing.fingerprint!==r.fingerprint)return reject('ONBOARDING_ALREADY_EXISTS','CONFLICT');
    return existing;
   }
   const [p,a,sub]=await Promise.all([tx.get(profile),tx.get(assignment),tx.get(db.collection('subscriptions').doc(r.tenantId))]);
   if(p.exists||a.exists)return reject('ONBOARDING_EXISTING_UNIT_USE_VERSIONED_CONFIGURATION','CONFLICT');
   if(!planAllows(sub.data() as Subscription|undefined,r.tenantId,Date.now()))return reject('ONBOARDING_ACTIVE_PLAN_REQUIRED','FORBIDDEN');
   for(const [ref,value] of [[profile,r.profile],[assignment,r.assignment]] as const){
    tx.create(ref,{tenantId:r.tenantId,unitId:r.unitId,latestVersion:1,updatedAt:r.createdAt});
    tx.create(ref.collection('versions').doc('1'),value);
   }
   tx.create(record,r);return r;
  });
 }
}
