import {FirestoreCustomerRepository} from '../customers/firestoreRepository';
import {FirestoreVerifiedCustomerChannelRepository} from '../fulfillment/trustedChannelIdentity';
import {FirestoreContactConsentRepository} from '../governance/repository';
import {createWhatsAppDeliveryService,FirestoreWhatsAppCustomerServicePolicy} from '../channels/whatsappDelivery';
import {FirestoreScheduleRepository} from '../scheduling/firestoreRepository';
import {SchedulingService} from '../scheduling/service';
import {PackNoticeService} from './notices';

export function createPackNoticeRuntime(){
 const store=new FirestoreScheduleRepository(),customers=new FirestoreCustomerRepository();
 return new PackNoticeService(store,new SchedulingService(store,customers),customers,
  new FirestoreVerifiedCustomerChannelRepository(),new FirestoreContactConsentRepository(),
  new FirestoreWhatsAppCustomerServicePolicy(),createWhatsAppDeliveryService());
}
