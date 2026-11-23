import {createHash} from 'node:crypto';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import type {PaymentStatus} from './model';
import type {OrderPaymentStatus} from '../orderPayments/model';
import type {MultisectorWebhookResult} from './multisectorWebhook';

export interface VerifiedPaymentWebhookEvent {
 tenantId:string;provider:string;eventId:string;providerPaymentId:string;
 paymentId:string;verifiedStatus:PaymentStatus|OrderPaymentStatus|MultisectorWebhookResult['status'];
 domain?:'ORDER_PAYMENT'|'RETAIL'|'BOOKING_DEPOSIT';
}
export interface VerifiedPaymentWebhookLedger {
 record(event:VerifiedPaymentWebhookEvent):Promise<void>;
}
export class FirestoreVerifiedWebhookLedger implements VerifiedPaymentWebhookLedger {
 async record(event:VerifiedPaymentWebhookEvent):Promise<void>{
  if(!getApps().length)initializeApp(process.env.FIREBASE_PROJECT_ID?{projectId:process.env.FIREBASE_PROJECT_ID}:undefined);
  const id=createHash('sha256').update(JSON.stringify([
   event.tenantId,event.provider,event.eventId,event.providerPaymentId
  ])).digest('hex');
  await getFirestore().collection('verifiedPaymentWebhookEvents').doc(id).set({
   ...event,id,verifiedAt:new Date().toISOString(),
  },{merge:true});
 }
}
export class InMemoryVerifiedWebhookLedger implements VerifiedPaymentWebhookLedger {
 readonly events=new Map<string,VerifiedPaymentWebhookEvent>();
 async record(e:VerifiedPaymentWebhookEvent){
  this.events.set(JSON.stringify([e.tenantId,e.provider,e.eventId,e.providerPaymentId]),e);
 }
}
