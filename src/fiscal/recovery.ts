import {createHash} from 'node:crypto';
import {getFirestore,FieldPath} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {Payment} from '../payments/model';
import type {PaymentConfirmationObserver} from './contracts';
import {ApplicationError} from '../infrastructure/errors';

export interface ConfirmedSalesPaymentSource {
 listConfirmed(limit:number):Promise<Payment[]>;
 recordFailure(payment:Payment,reasonCode:string):Promise<void>;
 clearFailure(payment:Payment):Promise<void>;
}
const firestore=()=>getFirestore(ensureFirebaseAdminApp());
const issueId=(p:Payment)=>createHash('sha256')
 .update(JSON.stringify([p.tenantId,p.id])).digest('hex');
export class FirestoreConfirmedSalesPaymentSource implements ConfirmedSalesPaymentSource {
 async listConfirmed(limit:number):Promise<Payment[]>{
  const db=firestore();
  const pageSize=Math.max(1,Math.min(125,Math.ceil(limit/2)));
  const payments:Payment[]=[];
  // Reconcile reversals too. Refunded payments must not disappear from the
  // source ledger before original fiscal evidence and a reversal review exist.
  for(const status of ['CONFIRMED','REFUNDED'] as const){
   const cursorRef=db.collection('fiscalHandoffRecoveryCursors').doc(status.toLowerCase());
   const saved=(await cursorRef.get()).data() as {afterId?:string}|undefined;
   const base=db.collection('payments').where('status','==',status)
    .orderBy(FieldPath.documentId()).limit(pageSize);
   let page=await (saved?.afterId?base.startAfter(saved.afterId):base).get();
   if(page.empty&&saved?.afterId){
    await cursorRef.delete();
    page=await base.get();
   }
   if(!page.empty)await cursorRef.set({afterId:page.docs.at(-1)!.id,
    updatedAt:new Date().toISOString()},{merge:true});
   for(const doc of page.docs)payments.push(doc.data() as Payment);
  }
  return payments;
 }
 async recordFailure(payment:Payment,reasonCode:string):Promise<void>{
  const safe=/^[A-Z0-9_]{1,80}$/.test(reasonCode)?reasonCode:'FISCAL_RECOVERY_UNCLASSIFIED';
  await firestore().collection('salesFiscalHandoffRecoveryIssues').doc(issueId(payment)).set({
   tenantId:payment.tenantId,paymentId:payment.id,quoteId:payment.quoteId,
   status:'REVIEW_REQUIRED',reasonCode:safe,requiresHumanReview:true,
   updatedAt:new Date().toISOString(),
  },{merge:true});
 }
 async clearFailure(payment:Payment):Promise<void>{
  const ref=firestore().collection('salesFiscalHandoffRecoveryIssues').doc(issueId(payment));
  const snap=await ref.get();
  if(snap.exists)await ref.set({status:'RESOLVED',requiresHumanReview:false,
   updatedAt:new Date().toISOString()},{merge:true});
 }
}
/** Repairs a confirmed-payment -> fiscal-source handoff gap without issuing invoices. */
export class FiscalHandoffRecoveryWorker {
 constructor(private readonly source:ConfirmedSalesPaymentSource,
  private readonly observer:PaymentConfirmationObserver){}
 async runOnce(limit=100){
  const summary={scanned:0,confirmed:0,refundReview:0,failed:0,skipped:0};
  for(const payment of await this.source.listConfirmed(limit)){
   summary.scanned++;
   if(payment.status!=='CONFIRMED'&&payment.status!=='REFUNDED'){summary.skipped++;continue;}
   try{
    if(payment.status==='REFUNDED'){
     // Historical PSP-verified confirmation is a commercial fact; a later
     // refund cannot erase it. Never classify or issue a fiscal reversal here.
     if(payment.confirmedAt)
      await this.observer.onConfirmed({...payment,status:'CONFIRMED'});
     await this.source.recordFailure(payment,payment.confirmedAt
      ?'FISCAL_REFUND_REVIEW_REQUIRED':'FISCAL_REFUND_WITHOUT_CONFIRMATION_REVIEW');
     summary.refundReview++;
    }else{
     await this.observer.onConfirmed(payment);
     await this.source.clearFailure(payment);
     summary.confirmed++;
    }
   }catch(error){
    const code=error instanceof ApplicationError?error.code:'FISCAL_RECOVERY_UNEXPECTED';
    await this.source.recordFailure(payment,code);
    summary.failed++;
   }
  }
  return summary;
 }
}
