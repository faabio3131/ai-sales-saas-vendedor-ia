import {FirestoreOrderRepository} from '../orders/firestoreRepository';
import {FirestoreOrderPaymentRepository} from '../orderPayments/firestoreRepository';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';
import {FirestoreUnitCatalogRepository} from '../commerce/firestoreRepository';
import {FirestoreFulfillmentSettingsRepository,FirestoreOperationRepository,
  FirestoreOperationOutboxRepository} from './firestoreRepository';
import {FulfillmentService} from './service';
import {EmptyProductionAdapterRegistry,FulfillmentWorker} from './worker';
import {createCustomerNoticePort} from './notifications';
import type {ProductionAdapterRegistry,CustomerNoticePort} from './model';
export function createFulfillmentRuntime(input?:{
 adapters?:ProductionAdapterRegistry;notices?:CustomerNoticePort
}){
 const operations=new FirestoreOperationRepository();
 const settings=new FirestoreFulfillmentSettingsRepository();
 const adapters=input?.adapters??new EmptyProductionAdapterRegistry();
 const service=new FulfillmentService({
  orders:new FirestoreOrderRepository(),
  payments:new FirestoreOrderPaymentRepository(),
  profiles:new FirestoreBusinessProfileRepository(),
  catalog:new FirestoreUnitCatalogRepository(),operations,settings,adapters,
 });
 const outbox=new FirestoreOperationOutboxRepository();
 const worker=new FulfillmentWorker(outbox,operations,service,adapters,
   input?.notices??createCustomerNoticePort());
 return {service,worker,settings,operations,outbox,adapters};
}
