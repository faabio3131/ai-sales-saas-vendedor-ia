import {FirestoreCustomerRepository} from '../customers/firestoreRepository';
import {FirestoreBookingIdentityRepository,FirestoreBookingConsentRepository} from './contactTrust';
import {createWhatsAppDeliveryService,FirestoreWhatsAppCustomerServicePolicy,FirestoreWhatsAppOutbox} from '../channels/whatsappDelivery';
import {FirestoreScheduleRepository} from '../scheduling/firestoreRepository';
import {SchedulingService} from '../scheduling/service';
import {PackNoticeService} from './notices';
import {MetaBookingTemplateService} from './templates';
import {FirestoreWhatsAppConnectionStore} from '../channels/whatsappConnections';
import {createWhatsAppVault} from '../channels/whatsappVault';

export function createPackNoticeRuntime(){
 const store=new FirestoreScheduleRepository(),customers=new FirestoreCustomerRepository();
 return new PackNoticeService(store,new SchedulingService(store,customers),customers,
  new FirestoreBookingIdentityRepository(),new FirestoreBookingConsentRepository(),
  new FirestoreWhatsAppCustomerServicePolicy(),createWhatsAppDeliveryService(),undefined,
  new MetaBookingTemplateService(new FirestoreWhatsAppConnectionStore(),createWhatsAppVault(),new FirestoreWhatsAppOutbox()));
}
