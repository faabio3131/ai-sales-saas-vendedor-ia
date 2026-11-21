import type {OperationMode} from '../business/model';
import type {LineSnapshot,Order,OrderFulfillmentInput} from '../orders/model';

export type ProductionState='NOT_DISPATCHED'|'AWAITING_ACK'|'QUEUED'|'IN_PREPARATION'|'READY'|'COMPLETED'|'MANUAL_REVIEW_REQUIRED';
export type DeliveryState='NOT_STARTED'|'OUT_FOR_DELIVERY'|'COMPLETED'|'PICKED_UP';
export type OperationState='AWAITING_ACK'|'QUEUED'|'IN_PREPARATION'|'READY'|'OUT_FOR_DELIVERY'|'COMPLETED'|'MANUAL_REVIEW_REQUIRED';
export type OperationEventName='ProductionDispatchRequested'|'ProductionDispatchAcknowledged'|
  'OrderReleasedToProduction'|'ProductionStarted'|'OrderReady'|'DeliveryDispatched'|
  'DeliveryCompleted'|'OrderPickupCompleted'|'ProductionDispatchEscalated';
export interface PostalRange {zoneId:string;fromCep:string;toCep:string;}
export interface UnitFulfillmentSettings {
  tenantId:string;unitId:string;version:number;
  operationMode:OperationMode;
  postalRanges:PostalRange[];
  prepMinutes:number;deliveryMinutes:number;pickupMinutes:number;
  /** Identifier of an installed, explicitly certified local adapter, not an arbitrary URL. */
  connectorId?:string;
  createdBy:string;updatedAt:string;
  activeOperations:number;
}
export interface UnitFulfillmentSettingsInput {
  expectedVersion:number;operationMode:OperationMode;
  postalRanges:PostalRange[];prepMinutes:number;deliveryMinutes:number;pickupMinutes:number;
  connectorId?:string;
}
export interface DeliveryAssessment {
  kind:'PICKUP'|'DELIVERY';accepted:true;
  zoneId?:string;cep?:string;address?:string;
  feeMinor:number;etaMinutes:number;etaSource:'MERCHANT_CONFIGURED_WINDOW';
  gpsValidated:false;liveTrackingAvailable:false;
}
export interface OperationRecord {
  tenantId:string;unitId:string;orderId:string;customerId:string;
  orderNumber:number;version:number;operationMode:OperationMode;
  settingsVersion:number;
  state:OperationState;productionState:ProductionState;deliveryState:DeliveryState;
  fulfillment:OrderFulfillmentInput;
  assessment:DeliveryAssessment;
  lines:LineSnapshot[];
  correlationId:string;dispatchIdempotencyKey:string;
  createdBy:string;createdAt:string;updatedAt:string;
  externalOrderId?:string;connectorId?:string;
  lastVerifiedExternalEventId?:string;
  lastFailureCode?:string;
  escalation?:{requestedBy:string;reason:string;at:string;manualDispatchAuthorized:false};
}
export interface OperationEvent {
  id:string;tenantId:string;unitId:string;orderId:string;customerId:string;
  operationVersion:number;name:OperationEventName;mode:OperationMode;
  occurredAt:string;actorId:string;
}
export interface OperationOutboxItem extends OperationEvent {
  work:'DISPATCH'|'CUSTOMER_NOTICE';
  deliveryStatus:'PENDING'|'PROCESSING'|'DELIVERED'|'DLQ';
  attemptCount:number;nextAttemptAt:number;leaseUntil:number;claimToken?:string;
  lastErrorCode?:string;
}
export interface ProductionDispatchEnvelope {
  schemaVersion:1;
  tenantId:string;unitId:string;orderId:string;orderNumber:number;customerId:string;
  correlationId:string;idempotencyKey:string;
  operationMode:'INTEGRATED_OPERATIONS';
  lines:LineSnapshot[];fulfillment:OrderFulfillmentInput;
}
export interface ProductionDispatchAck {
  schemaVersion:1;tenantId:string;unitId:string;orderId:string;
  correlationId:string;idempotencyKey:string;connectorId:string;
  accepted:boolean;externalOrderId:string;
  /** Defined by the provider adapter, never a caller-submitted field. */
  proofRef:string;
}
export interface VerifiedProductionStatus {
  tenantId:string;unitId:string;orderId:string;correlationId:string;
  connectorId:string;externalOrderId:string;providerEventId:string;
  status:'IN_PREPARATION'|'READY'|'OUT_FOR_DELIVERY'|'COMPLETED';
  /** Created exclusively by an installed adapter's authenticated event parser. */
  proofRef:string;
}
export interface ProductionDispatchPort {
  readonly id:string;readonly schemaVersion:1;
  /** Read-only validation; it never creates a kitchen order. */
  readiness(tenantId:string,unitId:string):Promise<boolean>;
  /** Provider must honor idempotencyKey on ALL retries, including timeouts. */
  dispatch(envelope:ProductionDispatchEnvelope):Promise<ProductionDispatchAck>;
  /** Must authenticate signature/certificate before returning a verified event. */
  verifyStatus(raw:unknown,tenantId:string,unitId:string):Promise<VerifiedProductionStatus>;
}
export interface ProductionAdapterRegistry {
  get(connectorId:string):ProductionDispatchPort|null;
}
export interface OperationRepository {
  get(tenantId:string,unitId:string,orderId:string):Promise<OperationRecord|null>;
  list(tenantId:string,unitId:string):Promise<OperationRecord[]>;
  start(operation:OperationRecord,event:OperationEvent,work:'DISPATCH'|'CUSTOMER_NOTICE'):Promise<OperationRecord>;
  advance(next:OperationRecord,expectedVersion:number,event:OperationEvent,
    work?:'CUSTOMER_NOTICE',inboxKey?:string):Promise<OperationRecord>;
  markEscalation(next:OperationRecord,expectedVersion:number,event:OperationEvent):Promise<OperationRecord>;
  hasActive(tenantId:string,unitId:string):Promise<boolean>;
}
export interface FulfillmentSettingsRepository {
  get(tenantId:string,unitId:string):Promise<UnitFulfillmentSettings|null>;
  publish(next:UnitFulfillmentSettings,expectedVersion:number):Promise<UnitFulfillmentSettings>;
}
export interface OperationOutboxRepository {
  claim(now:number,limit:number):Promise<OperationOutboxItem[]>;
  ack(id:string,claimToken:string,now:number):Promise<void>;
  retry(id:string,claimToken:string,now:number,code:string,maxAttempts:number):Promise<void>;
}
export interface CustomerNoticePort {
  send(event:OperationEvent,operation:OperationRecord):Promise<void>;
}
export interface OperationDependencies {
  orders:Pick<import('../orders/model').OrderRepository,'findById'|'listByScope'>;
  payments:Pick<import('../orderPayments/model').OrderPaymentRepository,'byOrder'>;
  profiles:Pick<import('../business/contracts').BusinessProfileRepository,'effective'>;
  catalog:Pick<import('../commerce/model').UnitCatalogRepository,'effective'>;
  settings:FulfillmentSettingsRepository;operations:OperationRepository;
  adapters:ProductionAdapterRegistry;
}
