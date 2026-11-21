import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {FirestoreOrderRepository} from '../orders/firestoreRepository';
import {OrderService} from '../orders/service';
import {ConversationOrderConfirmationVerifier} from '../orders/confirmationVerifier';
import {FirestoreUnitCatalogRepository} from '../commerce/firestoreRepository';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';
import {FirestoreCustomerRepository} from '../customers/firestoreRepository';
import {FirestoreConversationRepository,FirestoreMessageRepository} from '../conversations/firestoreRepository';
import {FirestoreVerifiedCustomerChannelRepository} from '../fulfillment/trustedChannelIdentity';
import {FirestoreFulfillmentSettingsRepository} from '../fulfillment/firestoreRepository';
import {createFulfillmentRuntime} from '../fulfillment/runtime';
import {createOrderPaymentRuntime} from '../orderPayments/runtime';
import {FirestoreRecoveryActionRepository,FirestoreRecoveryCandidateRepository} from '../recovery/firestoreRepository';
import {FirestoreOpportunityRepository} from '../leads/firestoreRepository';
import {RecoveryService} from '../recovery/service';
import {PolicyEngine} from '../policies/policyEngine';
import {FirestoreGovernanceRepository,FirestoreContactConsentRepository} from './repository';
import {FirestoreTrustedInboundRepository,AutonomousInboundTrust} from './trust';
import {GovernedAutonomyService} from './service';
import type {GovernedToolPorts} from './model';
import {deny} from './validation';

export function createGovernanceRuntime(){
 const store=new FirestoreGovernanceRepository();
 const orders=new FirestoreOrderRepository();
 const conversations=new FirestoreConversationRepository();
 const messages=new FirestoreMessageRepository();
 const customers=new FirestoreCustomerRepository();
 const trust=new AutonomousInboundTrust(conversations,messages,customers,
   new FirestoreVerifiedCustomerChannelRepository(),new FirestoreTrustedInboundRepository());
 const orderService=new OrderService(orders,new FirestoreUnitCatalogRepository(),
   new FirestoreBusinessProfileRepository(),customers,
   new ConversationOrderConfirmationVerifier(conversations,messages),
   ()=>new Date(),new FirestoreFulfillmentSettingsRepository());
 const payments=createOrderPaymentRuntime().service;
 const fulfillment=createFulfillmentRuntime().service;
 const candidates=new FirestoreRecoveryCandidateRepository();
 const recovery=new RecoveryService(new FirestoreOpportunityRepository(),
   candidates,new FirestoreRecoveryActionRepository(),new PolicyEngine(),
   {resolve:async(_tenantId:string)=>'AUTONOMOUS_GOVERNED'});
 const contact=new FirestoreContactConsentRepository();
 const ports:GovernedToolPorts={
  async orderStatus(s,id){
   const record=await orders.findById(s.tenantId,s.unitId,id);
   if(!record)deny('AUTONOMY_ORDER_NOT_FOUND','NOT_FOUND');
   return record!;
  },
  async draft(ctx,u,p,key){return orderService.createDraft(ctx,u,{...p,idempotencyKey:key} as
    unknown as import('../orders/model').CreateOrderInput);},
  async confirm(ctx,u,p){return orderService.confirm(ctx,u,String(p.orderId),{
    expectedVersion:Number(p.expectedVersion),
    confirmation:p.confirmation as import('../orders/model').ConfirmOrderInput['confirmation'],
  });},
  async payment(ctx,u,p,key){return payments.create(ctx,u,String(p.orderId),{
    method:p.method as import('../orderPayments/model').CreateOrderPaymentInput['method'],
    idempotencyKey:key,...(p.providerId?{providerId:String(p.providerId)}:{}),
    ...(p.payerEmail?{payerEmail:String(p.payerEmail)}:{}),
    ...(p.cashTenderedMinor!==undefined?{cashTenderedMinor:Number(p.cashTenderedMinor)}:{}),
  });},
  async release(ctx,u,orderId){return fulfillment.release(ctx,u,orderId);},
  async recovery(ctx,candidateId){return recovery.prepareAction(ctx,candidateId);},
  async recoveryCustomer(t,candidateId){
   const candidate=await candidates.findById(t,candidateId);
   return candidate?.customerId??null;
  },
  async contactConsent(t,u,c){
   const consent=await contact.get(t,u,c);
   if(!consent)return null;
   const [customer,identity]=await Promise.all([
     customers.findById(t,c),new FirestoreVerifiedCustomerChannelRepository().get(t,c,'WHATSAPP'),
   ]);
   return customer?.status==='ACTIVE'&&customer.phone===consent.recipient&&
     identity?.recipient===consent.recipient?consent:null;
  },
  async verifyTrustedInbound(t,u,id,ref){
   const order=await orders.findById(t,u,id);
   return !!order&&await trust.verify(order,ref);
  },
  async riskSignals(t,u,id){
   const key=createHash('sha256').update(JSON.stringify([t,u,id])).digest('hex');
   const doc=await getFirestore(ensureFirebaseAdminApp())
     .collection('governanceOrderRiskAssessments').doc(key).get();
   const risk=doc.data() as {tenantId?:string;unitId?:string;orderId?:string;
     status?:string;source?:string;signals?:string[]}|undefined;
   if(!risk||risk.tenantId!==t||risk.unitId!==u||risk.orderId!==id||
     risk.status!=='CLEARED'||risk.source!=='VERIFIED_CUSTOMER_MESSAGE'||
     !Array.isArray(risk.signals))
    return ['RISK_ASSESSMENT_NOT_VERIFIED'];
   return risk.signals;
  },
 };
 return new GovernedAutonomyService(store,ports);
}
