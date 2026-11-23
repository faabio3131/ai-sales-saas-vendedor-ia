import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ApplicationError} from '../infrastructure/errors';
import type {PaymentRepository,PaymentWebhookEventRepository} from './contracts';
import type {Payment,PaymentStatus,PaymentWebhookEvent} from './model';

/** Payment state and its fiscal *source event* share one Firestore transaction.
 * This is NOT a fiscal document, a tax decision, or authority to issue one.
 */
function database(){
 ensureFirebaseAdminApp();
 return getFirestore(ensureFirebaseAdminApp());
}
function conflict(code:string):never{
 throw new ApplicationError({category:'CONFLICT',code,message:'Canonical payment state conflict.'});
}
function fiscalFact(payment:Payment,oldStatus:PaymentStatus|null){
 if(payment.status!=='CONFIRMED'&&payment.status!=='REFUNDED')return null;
 if(payment.status==='CONFIRMED'&&(!payment.confirmedAt||
    !Number.isFinite(Date.parse(payment.confirmedAt))))conflict('PAYMENT_CONFIRMATION_TIMESTAMP_REQUIRED');
 const id=createHash('sha256').update(JSON.stringify([
  payment.tenantId,payment.id,payment.status,payment.confirmedAt??null,
 ])).digest('hex');
 return {id,tenantId:payment.tenantId,paymentId:payment.id,
  quoteId:payment.quoteId,customerId:payment.customerId,
  provider:payment.provider,providerPaymentId:payment.providerPaymentId??null,
  status:payment.status,previousStatus:oldStatus,amountMinor:payment.amountMinor,
  currency:payment.currency,confirmedAt:payment.confirmedAt??null,
  source:'CANONICAL_PAYMENT_TRANSACTION',at:payment.updatedAt};
}
function assertIdentity(old:Payment,next:Payment){
 if(old.id!==next.id||old.tenantId!==next.tenantId||
   old.quoteId!==next.quoteId||old.customerId!==next.customerId||
   old.amountMinor!==next.amountMinor||old.currency!==next.currency||
   old.provider!==next.provider||old.providerPaymentId!==next.providerPaymentId||
   old.merchantBindingHash!==next.merchantBindingHash||
   old.idempotencyKey!==next.idempotencyKey||old.method!==next.method)
  conflict('PAYMENT_FINANCIAL_IDENTITY_CONFLICT');
}
export class FirestorePaymentRepository implements PaymentRepository{
 async listByTenant(tenantId:string){
  const result=await database().collection('payments').where('tenantId','==',tenantId).get();
  return result.docs.map(doc=>doc.data() as Payment);
 }
 async findById(tenantId:string,id:string){
  const doc=await database().collection('payments').doc(id).get();
  const p=doc.data() as Payment|undefined;
  return p?.tenantId===tenantId?p:null;
 }
 async findByIdempotencyKey(tenantId:string,key:string){
  const result=await database().collection('payments').where('tenantId','==',tenantId)
   .where('idempotencyKey','==',key).limit(1).get();
  return result.empty?null:result.docs[0].data() as Payment;
 }
 async findByProviderPaymentId(tenantId:string,provider:string,providerPaymentId:string){
  const result=await database().collection('payments').where('tenantId','==',tenantId)
   .where('provider','==',provider).where('providerPaymentId','==',providerPaymentId).limit(1).get();
  return result.empty?null:result.docs[0].data() as Payment;
 }
 async create(payment:Payment){
  const db=database(),ref=db.collection('payments').doc(payment.id);
  const event=fiscalFact(payment,null);
  if(!event){await ref.create(payment);return payment;}
  const eventRef=db.collection('fiscalPaymentEvents').doc(event.id);
  await db.runTransaction(async tx=>{
   const [existing,eventExisting]=await Promise.all([tx.get(ref),tx.get(eventRef)]);
   if(existing.exists||eventExisting.exists)conflict('PAYMENT_CREATION_CONFLICT');
   tx.create(ref,payment);
   tx.create(eventRef,event);
  });
  return payment;
 }
 async update(payment:Payment,expectedStatus?:PaymentStatus):Promise<Payment>{
  const db=database(),ref=db.collection('payments').doc(payment.id);
  const event=fiscalFact(payment,expectedStatus??null);
  const eventRef=event?db.collection('fiscalPaymentEvents').doc(event.id):null;
  return db.runTransaction(async tx=>{
   const current=await tx.get(ref),prior=current.data() as Payment|undefined;
   if(!prior)conflict('PAYMENT_NOT_FOUND');
   assertIdentity(prior,payment);
   const priorStatus=prior.status;
   if(expectedStatus&&priorStatus!==expectedStatus){
    if(priorStatus===payment.status&&prior.confirmedAt===payment.confirmedAt)return prior;
    conflict('PAYMENT_CONCURRENT_STATUS_CONFLICT');
   }
   if(priorStatus==='REFUNDED'&&payment.status!=='REFUNDED')conflict('PAYMENT_TERMINAL_STATUS_CONFLICT');
   if(priorStatus==='CONFIRMED'&&!['CONFIRMED','REFUNDED'].includes(payment.status))
    conflict('PAYMENT_TERMINAL_STATUS_CONFLICT');
   const oldEvent=eventRef?await tx.get(eventRef):null;
   if(priorStatus===payment.status&&prior.confirmedAt===payment.confirmedAt&&oldEvent?.exists)
    return prior;
   tx.set(ref,payment);
   if(eventRef&&event&&!oldEvent?.exists)
    tx.create(eventRef,{...event,previousStatus:priorStatus});
   return payment;
  });
 }
}
export class FirestorePaymentWebhookEventRepository implements PaymentWebhookEventRepository{
 async findByEventId(tenantId:string,provider:string,eventId:string){
  const result=await database().collection('paymentWebhookEvents').where('tenantId','==',tenantId)
   .where('provider','==',provider).where('eventId','==',eventId).limit(1).get();
  return result.empty?null:result.docs[0].data() as PaymentWebhookEvent;
 }
 async create(event:PaymentWebhookEvent){
  await database().collection('paymentWebhookEvents').doc(event.id).create(event);
  return event;
 }
}
