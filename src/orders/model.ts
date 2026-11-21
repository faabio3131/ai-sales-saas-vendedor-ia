import type { CatalogKind,HalfHalfPricingRule } from '../commerce/model';
import type { OperationMode } from '../business/model';

export type FulfillmentOption='PICKUP'|'DELIVERY';
export type OrderStatus='DRAFT'|'CONFIRMED'|'CANCELLED';
export type PaymentState='NOT_REQUESTED'|'PENDING'|'CONFIRMED'|'FAILED'|'EXPIRED'|'REFUND_PENDING'|'REFUNDED';
export type ProductionState='NOT_DISPATCHED';
export type DeliveryState='NOT_STARTED';
export interface OrderLineSelection {
  catalogItemId:string;quantity:number;
  variantId?:string;sizeId?:string;
  flavorIds?:string[];borderId?:string;addonIds?:string[];
}
export type OrderFulfillmentInput =
  | {kind:'PICKUP'}
  | {kind:'DELIVERY';zoneId:string;address:string};
export interface CreateOrderInput {
  customerId:string;
  idempotencyKey:string;
  expectedCatalogVersion:number;
  lines:OrderLineSelection[];
  fulfillment:OrderFulfillmentInput;
  promotionCode?:string;
}
export interface UpdateOrderInput {
  expectedVersion:number;
  expectedCatalogVersion:number;
  lines:OrderLineSelection[];
  fulfillment:OrderFulfillmentInput;
  promotionCode?:string;
}
export interface ConfirmOrderInput {
  expectedVersion:number;
  /** Explicit human-verified approval; do not trust conversational AI text alone. */
  confirmation:{kind:'CUSTOMER_MESSAGE';evidenceRef:string;totalMinor:number};
}
export interface CancelOrderInput {expectedVersion:number;reason:string;}
export interface LineSnapshot {
  catalogItemId:string;kind:CatalogKind;name:string;quantity:number;
  variant?:{id:string;name:string};
  size?:{id:string;name:string};
  flavors?:Array<{id:string;name:string;priceMinor:number}>;
  halfHalfPricing?:HalfHalfPricingRule;
  border?:{id:string;name:string;priceMinor:number};
  addons?:Array<{id:string;name:string;priceMinor:number}>;
  comboComponents?:Array<{itemId:string;name:string;quantity:number}>;
  unitPriceMinor:number;totalMinor:number;
}
export interface Order {
  id:string;tenantId:string;unitId:string;orderNumber:number;version:number;
  customerId:string;status:OrderStatus;currency:'BRL';
  catalogVersion:number;businessProfileVersion:number;
  operationMode:OperationMode;
  lines:LineSnapshot[];
  fulfillment:OrderFulfillmentInput;
  subtotalMinor:number;discountMinor:number;deliveryFeeMinor:number;totalMinor:number;
  appliedPromotion?:{code:string;discountMinor:number};
  paymentState:PaymentState;productionState:ProductionState;deliveryState:DeliveryState;
  createdBy:string;createdAt:string;updatedAt:string;
  customerConfirmation?:{kind:'CUSTOMER_MESSAGE';evidenceRef:string;totalMinor:number;at:string;verifiedBy:string};
  cancellation?:{reason:string;at:string;actorId:string};
}
export interface OrderDispatchIntent {
  tenantId:string;unitId:string;orderId:string;orderNumber:number;
  operationMode:OperationMode;
  status:'NOT_DISPATCHED';
  /** T06 owns the actual dispatch command, ACK and outbox. */
  dispatchEnabled:false;
}
export interface OrderRepository {
  listByScope(tenantId:string,unitId:string):Promise<Order[]>;
  findById(tenantId:string,unitId:string,orderId:string):Promise<Order|null>;
  findByIdempotency(tenantId:string,unitId:string,key:string):Promise<{order:Order;fingerprint:string}|null>;
  createAtomic(draft:Order,key:string,fingerprint:string):Promise<Order>;
  updateAtomic(next:Order,expectedVersion:number):Promise<Order>;
}
export interface OrderConfirmationEvidence {
  verify(tenantId:string,customerId:string,reference:string,orderId:string,totalMinor:number):Promise<boolean>;
}
