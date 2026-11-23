import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {randomUUID} from 'node:crypto';
import {getFirestore,FieldValue,FieldPath} from 'firebase-admin/firestore';
import type {Payment} from './model';
import type {WebhookRefreshService} from './providerWebhooks';

const STATUS=['PENDING','CREATED'] as const;
const DEFAULT_BATCH=100;
const MAX_BATCH=250;
function database(){
 ensureFirebaseAdminApp();
 return getFirestore(ensureFirebaseAdminApp());
}
export interface PaymentReconciliationRepository {
 listPending(limit:number):Promise<Payment[]>;
 claim(paymentId:string,now:number):Promise<boolean|string>;
 finish(paymentId:string,now:number,succeeded:boolean,claimToken?:string):Promise<boolean|void>;
}
export class FirestoreReconciliationRepository implements PaymentReconciliationRepository {
 async listPending(limit:number):Promise<Payment[]> {
  const db=database();
  const max=Math.max(1,Math.min(limit,MAX_BATCH));
  const entries:Payment[]=[];
  // Rotate a durable cursor per status; otherwise a large backlog of offline
  // payments could permanently starve later online Pix transactions.
  for(const status of STATUS){
   const scanRef=db.collection('paymentReconciliationScanCursors').doc(status);
   const saved=await scanRef.get();
   const cursor=saved.data()?.afterId as string|undefined;
   const base=db.collection('payments').where('status','==',status)
    .orderBy(FieldPath.documentId()).limit(Math.max(1,Math.ceil(max/STATUS.length)));
   let result=await (cursor?base.startAfter(cursor):base).get();
   if(result.empty&&cursor)result=await base.get();
   if(!result.empty){
    const last=result.docs[result.docs.length-1];
    await scanRef.set({afterId:last.id,updatedAt:FieldValue.serverTimestamp()},{merge:true});
   }
   for(const doc of result.docs){
    const payment=doc.data() as Payment;
    if(payment.providerPaymentId&&payment.provider!=='OFFLINE'&&payment.method==='PIX')entries.push(payment);
    if(entries.length>=max)break;
   }
  }
  return entries;
 }
 async claim(paymentId:string,now:number):Promise<string|false>{
  const ref=database().collection('paymentReconciliationLeases').doc(paymentId);
  return database().runTransaction(async tx=>{
   const snapshot=await tx.get(ref);
   const record=snapshot.data() as {leaseUntil?:number;nextDueAt?:number}|undefined;
   if((record?.leaseUntil??0)>now||(record?.nextDueAt??0)>now)return false;
   const claimToken=randomUUID();
   tx.set(ref,{leaseUntil:now+120_000,claimToken,lastAttemptAt:now,
    updatedAt:FieldValue.serverTimestamp()},{merge:true});
   return claimToken;
  });
 }
 async finish(paymentId:string,now:number,succeeded:boolean,claimToken?:string):Promise<boolean>{
  const ref=database().collection('paymentReconciliationLeases').doc(paymentId);
  return database().runTransaction(async tx=>{
   const snap=await tx.get(ref);
   const record=snap.data() as {failureCount?:number;claimToken?:string}|undefined;
   if(!claimToken||record?.claimToken!==claimToken)return false;
   const count=succeeded?0:Math.min(10,(record?.failureCount??0)+1);
   const backoff=succeeded?5*60_000:Math.min(60*60_000,60_000*2**Math.min(count,6));
   tx.set(ref,{leaseUntil:0,claimToken:'',lastCompletedAt:now,nextDueAt:now+backoff,
    failureCount:count,lastStatus:succeeded?'OK':'RETRY',
    updatedAt:FieldValue.serverTimestamp()},{merge:true});
   return true;
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
   const claim=await this.repository.claim(payment.id,this.clock());
   if(!claim){summary.skipped++;continue;}
   const token=typeof claim==='string'?claim:undefined;
   summary.claimed++;
   try {
    const refreshed=await this.service.refresh({tenantId:payment.tenantId,requestId:'payment-reconciliation'},payment.id);
    if(refreshed.provider!==payment.provider||refreshed.amountMinor!==payment.amountMinor){
     throw new Error('Payment reconciliation mismatch');
    }
    const finalized=await this.repository.finish(payment.id,this.clock(),true,token);
    if(finalized===false){summary.failed++;continue;}
    if(refreshed.status==='CONFIRMED')summary.confirmed++;
    else summary.pending++;
   }catch{
    summary.failed++;
    await this.repository.finish(payment.id,this.clock(),false,token);
   }
  }
  return summary;
 }
}
