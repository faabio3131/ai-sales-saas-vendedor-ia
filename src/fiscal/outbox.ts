import {randomUUID} from 'node:crypto';
import {getFirestore,FieldPath} from 'firebase-admin/firestore';
import type {Transaction} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {Payment} from '../payments/model';
import type {PaymentConfirmationObserver} from './contracts';

export interface FiscalOutboxEntry {
 id:string;tenantId:string;state:'PENDING'|'COMPLETED'|'REVIEW_REQUIRED';
 createdAt:string;updatedAt:string;nextAttemptAt:number;leaseUntil:number;
 attempts:number;leaseToken?:string;lastErrorCode?:string;
}
const db=()=>getFirestore(ensureFirebaseAdminApp());
const entries=()=>db().collection('paymentFiscalOutbox');
/** Call within the very same Firestore transaction that creates/updates a confirmed payment.
 * The outbox is only an intent; it does not issue a fiscal document.
 */
export async function ensureFiscalIntentInTransaction(
 tx:Transaction,payment:Payment
):Promise<void>{
 if(payment.status!=='CONFIRMED')return;
 const ref=entries().doc(payment.id),prior=await tx.get(ref);
 if(prior.exists){
  const old=prior.data() as FiscalOutboxEntry;
  if(old.id!==payment.id||old.tenantId!==payment.tenantId)
   throw Error('FISCAL_OUTBOX_TENANT_CONFLICT');
  return;
 }
 const now=payment.updatedAt;
 const entry:FiscalOutboxEntry={id:payment.id,tenantId:payment.tenantId,
  state:'PENDING',createdAt:now,updatedAt:now,nextAttemptAt:0,leaseUntil:0,attempts:0};
 tx.create(ref,entry);
}

export class FirestoreFiscalOutboxRepository{
 async backfillConfirmed(limit=100):Promise<{scanned:number;created:number}>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>250)throw Error('FISCAL_SCAN_LIMIT_INVALID');
  const cursorRef=db().collection('paymentFiscalScanCursors').doc('CONFIRMED');
  const saved=await cursorRef.get(),after=saved.data()?.afterId as string|undefined;
  const query=db().collection('payments').where('status','==','CONFIRMED')
    .orderBy(FieldPath.documentId()).limit(limit);
  let page=await (after?query.startAfter(after):query).get();
  if(page.empty&&after)page=await query.get();
  let created=0;
  for(const item of page.docs){
   const payment=item.data() as Payment;
   if(payment.id!==item.id||payment.status!=='CONFIRMED'||!payment.tenantId)continue;
   const made=await db().runTransaction(async tx=>{
    const latest=(await tx.get(item.ref)).data() as Payment|undefined;
    if(!latest||latest.id!==item.id||latest.status!=='CONFIRMED')return false;
    const ref=entries().doc(latest.id);
    if((await tx.get(ref)).exists)return false;
    await ensureFiscalIntentInTransaction(tx,latest);
    return true;
   });
   if(made)created++;
  }
  if(!page.empty)await cursorRef.set({afterId:page.docs[page.docs.length-1].id,
   updatedAt:new Date().toISOString()});
  return {scanned:page.size,created};
 }
 async due(limit:number,now:number):Promise<FiscalOutboxEntry[]>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>250)throw Error('FISCAL_LIMIT_INVALID');
  const page=await entries().where('nextAttemptAt','<=',now)
    .orderBy('nextAttemptAt').limit(limit).get();
  return page.docs.map(d=>d.data() as FiscalOutboxEntry).filter(d=>d.state==='PENDING');
 }
 async claim(id:string,tenantId:string,now:number):Promise<string|false>{
  const ref=entries().doc(id);
  return db().runTransaction(async tx=>{
   const old=(await tx.get(ref)).data() as FiscalOutboxEntry|undefined;
   if(!old||old.id!==id||old.tenantId!==tenantId||old.state!=='PENDING'||
      old.leaseUntil>now||old.nextAttemptAt>now)return false;
   const token=randomUUID();
   tx.set(ref,{...old,leaseToken:token,leaseUntil:now+120_000,updatedAt:new Date(now).toISOString()});
   return token;
  });
 }
 async confirmedPayment(id:string,tenantId:string):Promise<Payment|null>{
  const snapshot=await db().collection('payments').doc(id).get();
  const payment=snapshot.data() as Payment|undefined;
  return payment?.tenantId===tenantId&&payment.id===id&&payment.status==='CONFIRMED'?payment:null;
 }
 async finish(id:string,tenantId:string,token:string,now:number,
   success:boolean,reason:string):Promise<boolean>{
  const ref=entries().doc(id);
  return db().runTransaction(async tx=>{
   const old=(await tx.get(ref)).data() as FiscalOutboxEntry|undefined;
   if(!old||old.tenantId!==tenantId||old.state!=='PENDING'||old.leaseToken!==token)
    return false;
   const attempts=old.attempts+1;
   const review=!success&&attempts>=8;
   tx.set(ref,{...old,attempts,leaseUntil:0,leaseToken:'',
    state:success?'COMPLETED':review?'REVIEW_REQUIRED':'PENDING',
    nextAttemptAt:success||review?Number.MAX_SAFE_INTEGER:
     now+Math.min(3600_000,30000*2**Math.min(attempts,7)),
    updatedAt:new Date(now).toISOString(),lastErrorCode:reason.slice(0,80)});
   return true;
  });
 }
}
export type FiscalOutboxStore = Pick<FirestoreFiscalOutboxRepository,
 'backfillConfirmed'|'due'|'claim'|'confirmedPayment'|'finish'>;
export class FiscalHandoffReconciliationWorker {
 constructor(private readonly outbox:FiscalOutboxStore,
  private readonly observer:PaymentConfirmationObserver,private readonly clock:()=>number=Date.now){}
 async runOnce(limit=100){
  const backfill=await this.outbox.backfillConfirmed(limit);
  const rows=await this.outbox.due(limit,this.clock());
  const summary={...backfill,queued:rows.length,completed:0,failed:0,skipped:0};
  for(const row of rows){
   const token=await this.outbox.claim(row.id,row.tenantId,this.clock());
   if(!token){summary.skipped++;continue;}
   try{
    const payment=await this.outbox.confirmedPayment(row.id,row.tenantId);
    if(!payment)throw Error('FISCAL_PAYMENT_NOT_CONFIRMED');
    await this.observer.onConfirmed(payment);
    const done=await this.outbox.finish(row.id,row.tenantId,token,this.clock(),true,'FISCAL_HANDOFF_RECORDED');
    if(done)summary.completed++;else summary.skipped++;
   }catch{
    await this.outbox.finish(row.id,row.tenantId,token,this.clock(),false,'FISCAL_HANDOFF_RETRY_REQUIRED');
    summary.failed++;
   }
  }
  return summary;
 }
}
