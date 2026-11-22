import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';

export interface VerifiedWebhookDelivery {
 id:string;tenantId:string;provider:string;providerPaymentId:string;eventId:string;
 state:'PENDING'|'COMPLETED'|'DLQ';attempts:number;nextAttemptAt:number;
 leaseUntil:number;firstSeenAt:number;updatedAt:number;lastErrorCode?:string;
}
export type VerifiedWebhookKey=Pick<VerifiedWebhookDelivery,'tenantId'|'provider'|'providerPaymentId'|'eventId'>;
export interface VerifiedWebhookRecoveryRepository {
 enqueue(event:VerifiedWebhookKey,now:number):Promise<void>;
 due(limit:number,now:number):Promise<VerifiedWebhookDelivery[]>;
 claim(id:string,now:number):Promise<boolean>;
 finish(id:string,now:number,success:boolean,reason:string):Promise<void>;
}
export function verifiedWebhookDeliveryId(e:VerifiedWebhookKey):string{
 return createHash('sha256').update(JSON.stringify([
  e.tenantId,e.provider,e.providerPaymentId,e.eventId,
 ])).digest('hex');
}
const table=()=>getFirestore(ensureFirebaseAdminApp()).collection('verifiedWebhookDeliveries');
export class FirestoreVerifiedWebhookRecoveryRepository implements VerifiedWebhookRecoveryRepository{
 async enqueue(e:VerifiedWebhookKey,now:number):Promise<void>{
  const id=verifiedWebhookDeliveryId(e),ref=table().doc(id);
  await getFirestore(ensureFirebaseAdminApp()).runTransaction(async tx=>{
   const previous=await tx.get(ref);
   if(previous.exists)return;
   const next:VerifiedWebhookDelivery={...e,id,state:'PENDING',attempts:0,
    nextAttemptAt:now,leaseUntil:0,firstSeenAt:now,updatedAt:now};
   tx.create(ref,next);
  });
 }
 async due(limit:number,now:number):Promise<VerifiedWebhookDelivery[]>{
  const page=await table().where('state','==','PENDING')
   .where('nextAttemptAt','<=',now).orderBy('nextAttemptAt')
   .limit(Math.min(100,Math.max(1,Math.floor(limit)))).get();
  return page.docs.map(d=>d.data() as VerifiedWebhookDelivery);
 }
 async claim(id:string,now:number):Promise<boolean>{
  const ref=table().doc(id);
  return getFirestore(ensureFirebaseAdminApp()).runTransaction(async tx=>{
   const old=(await tx.get(ref)).data() as VerifiedWebhookDelivery|undefined;
   if(!old||old.id!==id||old.state!=='PENDING'||
     old.nextAttemptAt>now||old.leaseUntil>now)return false;
   tx.set(ref,{...old,leaseUntil:now+120000,updatedAt:now});
   return true;
  });
 }
 async finish(id:string,now:number,success:boolean,reason:string):Promise<void>{
  const ref=table().doc(id);
  await getFirestore(ensureFirebaseAdminApp()).runTransaction(async tx=>{
   const old=(await tx.get(ref)).data() as VerifiedWebhookDelivery|undefined;
   if(!old||old.id!==id||old.state==='COMPLETED'||old.state==='DLQ')return;
   const attempts=old.attempts+1,dlq=!success&&attempts>=8;
   const next:VerifiedWebhookDelivery={...old,attempts,leaseUntil:0,updatedAt:now,
    state:success?'COMPLETED':dlq?'DLQ':'PENDING',
    nextAttemptAt:success||dlq?Number.MAX_SAFE_INTEGER:
      now+Math.min(3600000,30000*2**Math.min(attempts,7)),
    lastErrorCode:reason.slice(0,80)};
   tx.set(ref,next);
   if(dlq)tx.set(getFirestore(ensureFirebaseAdminApp()).collection('verifiedWebhookDeliveryDlq').doc(id),{
    ...evidenceOnly(next),reasonCode:next.lastErrorCode,requiresHumanReview:true,
   });
  });
 }
}
function evidenceOnly(e:VerifiedWebhookDelivery){
 return {id:e.id,tenantId:e.tenantId,provider:e.provider,eventId:e.eventId,
  providerPaymentId:e.providerPaymentId,attempts:e.attempts,at:new Date(e.updatedAt).toISOString()};
}
export class VerifiedWebhookRecoveryWorker {
 constructor(private readonly store:VerifiedWebhookRecoveryRepository,
  private readonly refresh:(event:VerifiedWebhookKey)=>Promise<string>,
  private readonly now:()=>number=Date.now){}
 async runOnce(limit=100){
  const summary={scanned:0,claimed:0,reconciled:0,failed:0,skipped:0};
  const entries=await this.store.due(limit,this.now());
  for(const row of entries){
   summary.scanned++;
   if(!await this.store.claim(row.id,this.now())){summary.skipped++;continue;}
   summary.claimed++;
   try{
    const verified=await this.refresh(row);
    if(!verified)throw Error('Missing verified status');
    await this.store.finish(row.id,this.now(),true,'PSP_GET_VERIFIED');
    summary.reconciled++;
   }catch{
    await this.store.finish(row.id,this.now(),false,'PSP_RECONCILIATION_FAILED');
    summary.failed++;
   }
  }
  return summary;
 }
}
