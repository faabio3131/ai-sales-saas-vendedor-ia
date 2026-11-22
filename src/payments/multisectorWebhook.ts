import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {ApplicationError} from '../infrastructure/errors';
import type {TenantContext} from '../types/contracts';
import type {PaymentProviderResolver} from './resolver';
import type {RetailOrder} from '../retail/model';
import type {Booking} from '../scheduling/model';
import {RetailService} from '../retail/service';
import {RetailPaymentService} from '../retail/payment';
import {FirestoreRetailRepository} from '../retail/firestoreRepository';
import {SchedulingService} from '../scheduling/service';
import {BookingDepositService} from '../scheduling/deposits';
import {FirestoreScheduleRepository} from '../scheduling/firestoreRepository';
import {FirestoreCustomerRepository} from '../customers/firestoreRepository';

export type MultisectorWebhookResult={
 domain:'RETAIL'|'BOOKING_DEPOSIT';paymentId:string;
 status:RetailOrder['payment']['state']|Booking['deposit']['status'];
};
export interface MultisectorWebhookService {
 refreshVerified(tenantId:string,provider:string,providerPaymentId:string):Promise<MultisectorWebhookResult|null>;
}
const scopeKey=(t:string,u:string)=>createHash('sha256').update(JSON.stringify([t,u])).digest('hex');
function mismatch():never{
 throw new ApplicationError({category:'CONFLICT',code:'PAYMENT_MULTISECTOR_BINDING_AMBIGUOUS',
  message:'Provider payment identity cannot be uniquely reconciled.'});
}
/** Only the authenticated bank-webhook internal path invokes this service. */
export class FirestoreMultisectorWebhookService implements MultisectorWebhookService {
 private readonly retail:RetailPaymentService;
 private readonly booking:BookingDepositService;
 constructor(resolver:PaymentProviderResolver) {
  const customers=new FirestoreCustomerRepository();
  const retailService=new RetailService(new FirestoreRetailRepository(),customers);
  const scheduleStore=new FirestoreScheduleRepository();
  const scheduling=new SchedulingService(scheduleStore,customers);
  this.retail=new RetailPaymentService(retailService,resolver);
  this.booking=new BookingDepositService(scheduleStore,scheduling,resolver);
 }
 async refreshVerified(t:string,provider:string,pid:string):Promise<MultisectorWebhookResult|null>{
  if(!t||!provider||!pid||pid.length>200)return mismatch();
  const database=getFirestore(ensureFirebaseAdminApp());
  const [retail,bookings]=await Promise.all([
   database.collectionGroup('orders').where('tenantId','==',t)
    .where('payment.provider','==',provider).where('payment.providerPaymentId','==',pid).limit(2).get(),
   database.collectionGroup('bookings').where('tenantId','==',t)
    .where('deposit.provider','==',provider).where('deposit.providerPaymentId','==',pid).limit(2).get(),
  ]);
  if(retail.size+bookings.size>1)return mismatch();
  if(retail.empty&&bookings.empty)return null;
  const doc=retail.empty?bookings.docs[0]:retail.docs[0];
  const row=doc.data() as RetailOrder|Booking;
  if(!row||row.tenantId!==t||typeof row.unitId!=='string'||!row.unitId||
   row.id!==doc.id)return mismatch();
  const root=retail.empty?'schedulingUnits':'retailUnits';
  if(doc.ref.parent.parent?.path!==root+'/'+scopeKey(t,row.unitId))return mismatch();
  // A trusted internal actor is constructed here, never from webhook headers.
  // Each domain still enforces scope and only PSP GET can settle.
  const ctx:TenantContext={tenantId:t,userId:'verified-psp-webhook',role:'OWNER',
   requestId:'bank-webhook'};
  if(!retail.empty){
   const paid=await this.retail.refresh(ctx,row.unitId,row.id,{});
   if(paid.payment.provider!==provider||paid.payment.providerPaymentId!==pid)return mismatch();
   return {domain:'RETAIL',paymentId:row.id,status:paid.payment.state};
  }
  const updated=await this.booking.refresh(ctx,row.unitId,row.id,{});
  if(updated.deposit.provider!==provider||updated.deposit.providerPaymentId!==pid)return mismatch();
  return {domain:'BOOKING_DEPOSIT',paymentId:row.id,status:updated.deposit.status};
 }
}
