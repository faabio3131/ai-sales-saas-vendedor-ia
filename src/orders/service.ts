import { createHash,randomUUID } from 'node:crypto';
import type { TenantContext } from '../types/contracts';
import type { CustomerRepository } from '../customers/contracts';
import type { BusinessProfileRepository } from '../business/contracts';
import { requireBusinessScope } from '../business/service';
import { catalogError,catalogId,catalogText } from '../commerce/service';
import type { UnitCatalogRepository } from '../commerce/model';
import { priceOrder } from './pricing';
import {assessDelivery,rejected} from '../fulfillment/policy';
import type {FulfillmentSettingsRepository} from '../fulfillment/model';
import type {PricedOrder} from './pricing';
import type {
  Order,OrderRepository,OrderConfirmationEvidence,CreateOrderInput,UpdateOrderInput,
  ConfirmOrderInput,CancelOrderInput,OrderDispatchIntent,OrderLineSelection
} from './model';

const ALLOWED_ROLES=['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF'];
function authorize(ctx:TenantContext):void{
  if(!ctx.userId?.trim()||!ALLOWED_ROLES.includes(ctx.role??''))
    catalogError('ORDER_OPERATOR_UNAUTHORIZED','FORBIDDEN');
}
function allowedKeys(value:object,keys:string[]):void{
  if(Object.keys(value).some(k=>!keys.includes(k)))catalogError('ORDER_FIELDS_INVALID');
}
function stable(value:unknown):string{
  if(value===null)return 'null';
  if(typeof value==='string'||typeof value==='boolean'||typeof value==='number'){
    if(typeof value==='number'&&!Number.isFinite(value))catalogError('ORDER_FIELDS_INVALID');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(typeof value==='object'){
    if(Object.getPrototypeOf(value)!==Object.prototype)catalogError('ORDER_FIELDS_INVALID');
    const obj=value as Record<string,unknown>;
    return '{'+Object.keys(obj).sort().filter(k=>obj[k]!==undefined)
      .map(k=>JSON.stringify(k)+':'+stable(obj[k])).join(',')+'}';
  }
  catalogError('ORDER_FIELDS_INVALID');
}
function requestHash(scope:{tenantId:string;unitId:string},input:CreateOrderInput):string{
  return createHash('sha256').update(stable({
    tenantId:scope.tenantId,unitId:scope.unitId,customerId:input.customerId,
    lines:input.lines,fulfillment:input.fulfillment,promotionCode:input.promotionCode,
    expectedCatalogVersion:input.expectedCatalogVersion,
  })).digest('hex');
}
function idempotencyKey(value:unknown):string {
  if(typeof value!=='string'||! /^(?=.{8,100}$)[a-zA-Z0-9_:-]+$/.test(value))
    catalogError('ORDER_IDEMPOTENCY_KEY_INVALID');
  return value;
}
function version(v:unknown):number{
  if(!Number.isSafeInteger(v)||Number(v)<1)catalogError('ORDER_VERSION_INVALID');
  return v as number;
}
function validateSelections(lines:unknown):OrderLineSelection[]{
  if(!Array.isArray(lines)||lines.length<1||lines.length>40)
    catalogError('ORDER_LINES_INVALID');
  return lines as OrderLineSelection[];
}
export class OrderService {
  constructor(
    private readonly orders:OrderRepository,
    private readonly catalog:UnitCatalogRepository,
    private readonly businesses:BusinessProfileRepository,
    private readonly customers:CustomerRepository,
    private readonly confirmation:OrderConfirmationEvidence,
    private readonly clock:()=>Date=()=>new Date(),
    private readonly deliveryPolicies?:Pick<FulfillmentSettingsRepository,'get'>,
  ){}
  private async validateDeliveryBeforePayment(
    tenantId:string,unitId:string,profile:import('../business/model').BusinessProfileRevision,
    catalog:import('../commerce/model').UnitCatalogRevision,
    priced:Pick<PricedOrder,'fulfillment'|'deliveryFeeMinor'>):Promise<void>{
    if(priced.fulfillment.kind==='PICKUP'||!this.deliveryPolicies)return;
    const settings=await this.deliveryPolicies.get(tenantId,unitId);
    if(!settings||settings.operationMode!==profile.capabilityRegistry.operationMode)
      rejected('FULFILLMENT_DELIVERY_POLICY_MISSING');
    assessDelivery(priced,settings,catalog); // fail before payment/confirmation
  }
  private scope(ctx:TenantContext,unitId:string){
    authorize(ctx);
    return requireBusinessScope(ctx,unitId);
  }
  async list(ctx:TenantContext,unitId:string):Promise<Order[]>{
    const s=this.scope(ctx,unitId);
    return this.orders.listByScope(s.tenantId,s.unitId);
  }
  async get(ctx:TenantContext,unitId:string,orderId:string):Promise<Order>{
    const s=this.scope(ctx,unitId);
    const order=await this.orders.findById(s.tenantId,s.unitId,catalogId(orderId));
    if(!order)catalogError('ORDER_NOT_FOUND','NOT_FOUND');
    return order;
  }
  private async ready(ctx:TenantContext,unitId:string,now:string){
    const s=this.scope(ctx,unitId);
    const [profile,catalog]=await Promise.all([
      this.businesses.effective(s.tenantId,s.unitId,now),
      this.catalog.effective(s.tenantId,s.unitId,now),
    ]);
    if(!profile||!profile.capabilityRegistry.capabilities.includes('ORDERING'))
      catalogError('ORDER_CAPABILITY_DISABLED','CONFLICT');
    if(!catalog)catalogError('ORDER_CATALOG_UNAVAILABLE','CONFLICT');
    return {...s,profile:profile!,catalog:catalog!};
  }
  async createDraft(ctx:TenantContext,unitId:string,input:CreateOrderInput):Promise<Order>{
    const s=this.scope(ctx,unitId);
    if(!input||typeof input!=='object'||Array.isArray(input))catalogError('ORDER_FIELDS_INVALID');
    allowedKeys(input,['customerId','idempotencyKey','expectedCatalogVersion',
      'lines','fulfillment','promotionCode']);
    const customerId=catalogId(input.customerId);
    const idem=idempotencyKey(input.idempotencyKey);
    version(input.expectedCatalogVersion);
    validateSelections(input.lines);
    const fingerprint=requestHash(s,input);
    const previous=await this.orders.findByIdempotency(s.tenantId,s.unitId,idem);
    if(previous){
      if(previous.fingerprint!==fingerprint)catalogError('ORDER_IDEMPOTENCY_CONFLICT','CONFLICT');
      return previous.order;
    }
    const customer=await this.customers.findById(s.tenantId,customerId);
    if(!customer)catalogError('ORDER_CUSTOMER_NOT_FOUND','NOT_FOUND');
    const now=this.clock().toISOString();
    const ready=await this.ready(ctx,unitId,now);
    if(ready.catalog.version!==input.expectedCatalogVersion)
      catalogError('ORDER_CATALOG_VERSION_STALE','CONFLICT');
    if(input.fulfillment?.kind==='DELIVERY'&&
      !ready.profile.capabilityRegistry.capabilities.includes('DELIVERY'))
      catalogError('ORDER_DELIVERY_DISABLED','CONFLICT');
    const priced=priceOrder(ready.catalog,input,now);
    await this.validateDeliveryBeforePayment(s.tenantId,s.unitId,ready.profile,ready.catalog,priced);
    const draft:Order={
      id:'order_'+randomUUID().replace(/-/g,''),
      ...s,orderNumber:0,version:0,customerId,
      status:'DRAFT',currency:'BRL',catalogVersion:ready.catalog.version,
      businessProfileVersion:ready.profile.version,
      operationMode:ready.profile.capabilityRegistry.operationMode,
      ...priced,paymentState:'NOT_REQUESTED',productionState:'NOT_DISPATCHED',
      deliveryState:'NOT_STARTED',createdBy:ctx.userId!,createdAt:now,updatedAt:now,
    };
    // Transaction handles concurrent identical idempotency keys and atomic numbering.
    return this.orders.createAtomic(draft,idem,fingerprint);
  }
  async updateDraft(ctx:TenantContext,unitId:string,orderId:string,
    input:UpdateOrderInput):Promise<Order>{
    if(!input||typeof input!=='object'||Array.isArray(input))catalogError('ORDER_FIELDS_INVALID');
    allowedKeys(input,['expectedVersion','expectedCatalogVersion','lines','fulfillment','promotionCode']);
    version(input.expectedVersion);version(input.expectedCatalogVersion);
    validateSelections(input.lines);
    const before=await this.get(ctx,unitId,orderId);
    if(before.status!=='DRAFT')catalogError('ORDER_NOT_EDITABLE','CONFLICT');
    if(before.version!==input.expectedVersion)catalogError('ORDER_VERSION_CONFLICT','CONFLICT');
    const now=this.clock().toISOString();
    const ready=await this.ready(ctx,unitId,now);
    if(ready.catalog.version!==input.expectedCatalogVersion)
      catalogError('ORDER_CATALOG_VERSION_STALE','CONFLICT');
    if(ready.profile.capabilityRegistry.operationMode!==before.operationMode)
      catalogError('ORDER_OPERATION_MODE_CHANGED','CONFLICT');
    if(input.fulfillment?.kind==='DELIVERY'&&
      !ready.profile.capabilityRegistry.capabilities.includes('DELIVERY'))
      catalogError('ORDER_DELIVERY_DISABLED','CONFLICT');
    const priced=priceOrder(ready.catalog,input,now);
    await this.validateDeliveryBeforePayment(before.tenantId,before.unitId,ready.profile,ready.catalog,priced);
    const after:Order={...before,...priced,catalogVersion:ready.catalog.version,
      businessProfileVersion:ready.profile.version,version:before.version+1,
      updatedAt:now};
    return this.orders.updateAtomic(after,before.version);
  }
  async confirm(ctx:TenantContext,unitId:string,orderId:string,
    input:ConfirmOrderInput):Promise<Order>{
    if(!input||typeof input!=='object'||Array.isArray(input))catalogError('ORDER_CONFIRMATION_INVALID');
    allowedKeys(input,['expectedVersion','confirmation']);
    version(input.expectedVersion);
    const previous=await this.get(ctx,unitId,orderId);
    if(previous.status!=='DRAFT'||previous.version!==input.expectedVersion)
      catalogError('ORDER_NOT_CONFIRMABLE','CONFLICT');
    const conf=input.confirmation;
    if(!conf||typeof conf!=='object'||Array.isArray(conf))catalogError('ORDER_CONFIRMATION_INVALID');
    allowedKeys(conf,['kind','evidenceRef','totalMinor']);
    if(conf.kind!=='CUSTOMER_MESSAGE'||conf.totalMinor!==previous.totalMinor)
      catalogError('ORDER_TOTAL_NOT_ACKNOWLEDGED','CONFLICT');
    const evidenceRef=catalogText(conf.evidenceRef,220);
    const now=this.clock().toISOString();
    const ready=await this.ready(ctx,unitId,now);
    if(ready.catalog.version!==previous.catalogVersion||
      ready.profile.capabilityRegistry.operationMode!==previous.operationMode)
      catalogError('ORDER_REQUOTE_REQUIRED','CONFLICT');
    await this.validateDeliveryBeforePayment(previous.tenantId,previous.unitId,
      ready.profile,ready.catalog,previous);
    if(!(await this.confirmation.verify(previous.tenantId,previous.customerId,
      evidenceRef,previous.id,previous.totalMinor)))
      catalogError('ORDER_CUSTOMER_CONFIRMATION_UNVERIFIED','CONFLICT');
    return this.orders.updateAtomic({
      ...previous,status:'CONFIRMED',version:previous.version+1,updatedAt:now,
      customerConfirmation:{kind:'CUSTOMER_MESSAGE',evidenceRef,
        totalMinor:previous.totalMinor,at:now,verifiedBy:ctx.userId!},
    },previous.version);
  }
  async cancel(ctx:TenantContext,unitId:string,orderId:string,
    input:CancelOrderInput):Promise<Order>{
    const before=await this.get(ctx,unitId,orderId);
    if(!input||typeof input!=='object'||Array.isArray(input))
      catalogError('ORDER_CANCELLATION_INVALID');
    allowedKeys(input,['expectedVersion','reason']);
    version(input.expectedVersion);
    if(before.version!==input.expectedVersion||before.status==='CANCELLED')
      catalogError('ORDER_NOT_CANCELLABLE','CONFLICT');
    // T04 owns the settlement/refund saga once a payment attempt exists.
    if(before.paymentState!=='NOT_REQUESTED')
      catalogError('ORDER_CANCELLATION_REQUIRES_PAYMENT_REVIEW','CONFLICT');
    const reason=catalogText(input.reason,240);
    const now=this.clock().toISOString();
    // No refund/payment action happens in T03, even for already confirmed orders.
    return this.orders.updateAtomic({...before,status:'CANCELLED',
      version:before.version+1,updatedAt:now,
      cancellation:{reason,at:now,actorId:ctx.userId!}},before.version);
  }
  async dispatchIntent(ctx:TenantContext,unitId:string,orderId:string):
  Promise<OrderDispatchIntent>{
    const order=await this.get(ctx,unitId,orderId);
    if(order.status!=='CONFIRMED')catalogError('ORDER_NOT_CONFIRMED','CONFLICT');
    if(order.productionState!=='NOT_DISPATCHED')
      catalogError('ORDER_ALREADY_RELEASED_TO_PRODUCTION','CONFLICT');
    return {tenantId:order.tenantId,unitId:order.unitId,
      orderId:order.id,orderNumber:order.orderNumber,
      operationMode:order.operationMode,status:'NOT_DISPATCHED',dispatchEnabled:false};
  }
}
