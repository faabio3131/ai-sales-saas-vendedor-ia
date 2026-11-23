import type { PaymentProviderInterface } from '../payments/contracts';
import type { PaymentMethod } from '../payments/model';
export type OrderPaymentMethod=Extract<PaymentMethod,
  'PIX'|'PAYMENT_LINK'|'CHECKOUT'|'PIX_MANUAL'|'CARD_ON_DELIVERY'|'CASH_ON_DELIVERY'>;
export type OrderPaymentStatus=
  'CREATION_RESERVED'|'PENDING'|'RECONCILIATION_REQUIRED'|'CONFIRMED'|
  'FAILED'|'CANCELLED'|'EXPIRED'|'REFUND_PENDING'|'REFUNDED';
export type OrderPaymentEventKind=
  'PAYMENT_INTENT_RESERVED'|'PAYMENT_AWAITING_VERIFICATION'|'PAYMENT_CONFIRMED'|
  'PAYMENT_FAILED'|'PAYMENT_EXPIRED'|'PAYMENT_CANCELLED'|
  'PAYMENT_RECONCILIATION_REQUIRED'|'PAYMENT_REFUND_REQUESTED'|'PAYMENT_REFUNDED';
export interface OrderPayment {
  id:string;tenantId:string;unitId:string;orderId:string;customerId:string;
  version:number;method:OrderPaymentMethod;status:OrderPaymentStatus;
  amountMinor:number;currency:'BRL';provider:string;providerPaymentId?:string;
  merchantBindingHash?:string;
  idempotencyKey:string;fingerprint:string;
  paymentUrl?:string;pixCode?:string;pixQrCodeBase64?:string;expiresAt?:string;
  cashTenderedMinor?:number;changeMinor?:number;
  createdAt:string;updatedAt:string;createdBy:string;confirmedAt?:string;
  verifiedBy?:string;verificationSource?:'PSP_GET'|'OPERATOR_COD';
  receiptRef?:string;refund?:{reason:string;requestedBy:string;requestedAt:string};
}
export interface OrderPaymentEvent {
  id:string;tenantId:string;unitId:string;orderId:string;paymentId:string;
  paymentVersion:number;kind:OrderPaymentEventKind;status:OrderPaymentStatus;
  amountMinor:number;method:OrderPaymentMethod;provider:string;occurredAt:string;
  verificationSource?:'PSP_GET'|'OPERATOR_COD';verifiedBy?:string;receiptRef?:string;
}
export interface OutboxRecord extends OrderPaymentEvent {
  deliveryStatus:'PENDING'|'PROCESSING'|'DELIVERED'|'DLQ';
  attemptCount:number;nextAttemptAt:number;leaseUntil:number;
  updatedAt:string;lastErrorCode?:string;claimToken?:string;
}
export interface CreateOrderPaymentInput {
  idempotencyKey:string;method:OrderPaymentMethod;
  providerId?:string;payerEmail?:string;cashTenderedMinor?:number;
}
export interface ConfirmOfflineCollectionInput {
  expectedVersion:number;amountMinor:number;receiptRef:string;receivedMinor?:number;
}
export interface RefundOrderPaymentInput {expectedVersion:number;reason:string;}
export interface OrderPaymentRepository {
  get(tenantId:string,unitId:string,id:string):Promise<OrderPayment|null>;
  byOrder(tenantId:string,unitId:string,orderId:string):Promise<OrderPayment|null>;
  byIdempotency(tenantId:string,unitId:string,key:string):Promise<OrderPayment|null>;
  byProvider(tenantId:string,provider:string,providerPaymentId:string):Promise<OrderPayment|null>;
  reserve(payment:OrderPayment):Promise<{payment:OrderPayment;created:boolean}>;
  transition(next:OrderPayment,expectedVersion:number,event:OrderPaymentEventKind):Promise<OrderPayment>;
}
export interface OutboxRepository {
  claim(now:number,limit:number):Promise<OutboxRecord[]>;
  delivered(id:string,claimToken:string,now:number):Promise<void>;
  retry(id:string,claimToken:string,now:number,errorCode:string,maxAttempts:number):Promise<void>;
}
export interface FinancialEventConsumer {publish(event:OutboxRecord):Promise<void>;}
/** Service uses existing merchant PSP adapters and tenant-bound vault. */
export interface OrderPaymentProviderResolver {
  forNewPayment(tenantId:string,providerId?:string):Promise<PaymentProviderInterface>;
  forNewPaymentWithBinding?(tenantId:string,providerId?:string):Promise<{provider:PaymentProviderInterface;bindingHash:string}>;
  forRecordedPayment(record:{tenantId:string;provider:string;merchantBindingHash?:string}):Promise<PaymentProviderInterface>;
}
