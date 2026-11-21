import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import type {Payment} from './model';
import type {WebhookRefreshService} from './providerWebhooks';

const STATUS=['PENDING','CREATED'] as const;
const DEFAULT_BATCH=100;
const MAX_BATCH=250;
function database(){
 if(!getApps().length)initializeApp(process.env.FIREBASE_PROJECT_ID?{projectId:process.env.FIREBASE_PROJECT_ID}:undefined);
 return getFirestore();
}
export interface PaymentReconciliationRepository {
 listPending(limit:number):Promise<Payment[]>;
 claim(paymentId:string,now:number):Promise<boolean>;
 finish(paymentId:string,now:number,succeeded:boolean):Promise<void>;
}
export class FirestoreReconciliationRepository implements PaymentReconciliationRepository {
 async listPending(limit:number):Promise<Payment[]> {
  const db=database();
  const max=Math.max(1,Math.min(limit,MAX_BATCH));
  const entries:Payment[]=[];
  // Query by status only; avoids tenant-specific composite index requirements.
  for(const status of STATUS){
   const results=await db.collection('payments').where('status','==',status).limit(max).get();
   for(const doc of results.docs){
    const payment=doc.data() as Payment;
    if(payment.providerPaymentId&&payment.provider!=='OFFLINE'&&payment.method==='PIX')entries.push(payment);
    if(entries.length>=max)break;
   }
   if(entries.length>=max)break;
  }
  return entries;
 }
 async claim(paymentId:string,now:number):Promise<boolean>{
  const ref=database().collection('paymentReconciliationLeases').doc(paymentId);
  return database().runTransaction(async tx=>{
   const snapshot=await tx.get(ref);
   const record=snapshot.data() as {leaseUntil?:number;nextDueAt?:number}|undefined;
   if((record?.leaseUntil??0)>now||(record?.nextDueAt??0)>now)return false;
   tx.set(ref,{leaseUntil:now+120_000,lastAttemptAt:now,updatedAt:FieldValue.serverTimestamp()},{merge:true});
   return true;
  });
 }
 async finish(paymentId:string,now:number,succeeded:boolean):Promise<void>{
  const ref=database().collection('paymentReconciliationLeases').doc(paymentId);
  await database().runTransaction(async tx=>{
   const snap=await tx.get(ref);
   const record=snap.data() as {failureCount?:number}|undefined;
   const count=succeeded?0:Math.min(10,(record?.failureCount??0)+1);
   const backoff=succeeded?5*60_000:Math.min(60*60_000,60_000*2**Math.min(count,6));
   tx.set(ref,{leaseUntil:0,lastCompletedAt:now,nextDueAt:now+backoff,
    failureCount:count,lastStatus:succeeded?'OK':'RETRY',
    updatedAt:FieldValue.serverTimestamp()},{merge:true});
  });
 }
}
export interface ReconciliationSummary {
 scanned:number;claimed:number;confirmed:number;pending:number;failed:number;skipped:number;
}
export class PaymentReconciliationWorker {
 constructor(
  private readonly repository:PaymentReconciliationRepository,
  private readonly service:WebhookRefreshService,
  private readonly clock:()=>number=Date.now,
 ){}
 async runOnce(limit:number=DEFAULT_BATCH):Promise<ReconciliationSummary>{
  const summary:ReconciliationSummary={scanned:0,claimed:0,confirmed:0,pending:0,failed:0,skipped:0};
  const payments=await this.repository.listPending(Math.max(1,Math.min(limit,MAX_BATCH)));
  for(const payment of payments){
   summary.scanned++;
   if(!payment.providerPaymentId||payment.provider==='OFFLINE'||payment.method!=='PIX'){summary.skipped++;continue;}
   if(!await this.repository.claim(payment.id,this.clock())){summary.skipped++;continue;}
   summary.claimed++;
   try {
    const refreshed=await this.service.refresh({tenantId:payment.tenantId,requestId:'payment-reconciliation'},payment.id);
    if(refreshed.provider!==payment.provider||refreshed.amountMinor!==payment.amountMinor){
     throw new Error('Payment reconciliation mismatch');
    }
    if(refreshed.status==='CONFIRMED')summary.confirmed++;
    else summary.pending++;
    await this.repository.finish(payment.id,this.clock(),true);
   }catch{
    summary.failed++;
    await this.repository.finish(payment.id,this.clock(),false);
   }
  }
  return summary;
 }
}
