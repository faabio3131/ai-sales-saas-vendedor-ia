import {createHash} from 'node:crypto';
import type {TenantContext} from '../types/contracts';
import {rejected,operationalScope,VIEW,RELEASE,KITCHEN,DELIVERY,ADMIN,
  parseSettings,assessDelivery,stateProjection,eventFor,canAdvance} from './policy';
import type {OperationDependencies,OperationRecord,OperationEvent,OperationState,
  UnitFulfillmentSettingsInput,ProductionDispatchAck,VerifiedProductionStatus,
  ProductionDispatchEnvelope,OperationEventName} from './model';

function id(...values:string[]):string{
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
function validText(s:unknown,max=180):string{
  if(typeof s!=='string'||!s.trim()||s.trim().length>max||/[\u0000-\u001f]/.test(s))
    rejected('FULFILLMENT_TEXT_INVALID','VALIDATION');
  return s.trim();
}
function keys(input:unknown,allowed:string[]):void{
 if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).some(k=>!allowed.includes(k)))
   rejected('FULFILLMENT_FIELDS_INVALID','VALIDATION');
}
function event(op:OperationRecord,name:OperationEventName,actorId:string):OperationEvent{
 return {
   id:id(op.tenantId,op.unitId,op.orderId,String(op.version),name),
   tenantId:op.tenantId,unitId:op.unitId,orderId:op.orderId,customerId:op.customerId,
   operationVersion:op.version,name,mode:op.operationMode,
   occurredAt:op.updatedAt,actorId,
 };
}
export class FulfillmentService {
 constructor(private readonly dep:OperationDependencies,
   private readonly clock:()=>Date=()=>new Date()){}
 async settings(ctx:TenantContext,unitId:string){
  const s=operationalScope(ctx,unitId,VIEW);
  return this.dep.settings.get(s.tenantId,s.unitId);
 }
 async publishSettings(ctx:TenantContext,unitId:string,input:UnitFulfillmentSettingsInput){
  const s=operationalScope(ctx,unitId,ADMIN);
  const now=this.clock().toISOString();
  const next=parseSettings(s,input,ctx.userId!,now);
  const [profile,previous,orders]=await Promise.all([
   this.dep.profiles.effective(s.tenantId,s.unitId,now),
   this.dep.settings.get(s.tenantId,s.unitId),
   this.dep.orders.listByScope(s.tenantId,s.unitId),
  ]);
  if(!profile||!profile.capabilityRegistry.capabilities.includes('PRODUCTION')||
     profile.capabilityRegistry.operationMode!==next.operationMode)
    rejected('FULFILLMENT_PROFILE_MODE_MISMATCH');
  if((previous?.version??0)!==input.expectedVersion)
    rejected('FULFILLMENT_SETTINGS_VERSION_CONFLICT');
  if(previous&&previous.operationMode!==next.operationMode){
    if(await this.dep.operations.hasActive(s.tenantId,s.unitId)||
      orders.some(o=>o.status==='CONFIRMED'&&o.productionState!=='COMPLETED'))
      rejected('FULFILLMENT_MODE_ACTIVE_ORDERS');
  }
  if(next.operationMode==='INTEGRATED_OPERATIONS'){
    const connector=next.connectorId?this.dep.adapters.get(next.connectorId):null;
    if(!connector||connector.schemaVersion!==1||
      !await connector.readiness(s.tenantId,s.unitId))
      rejected('FULFILLMENT_CONNECTOR_NOT_VERIFIED','PROVIDER');
  }
  return this.dep.settings.publish(next,input.expectedVersion);
 }
 async list(ctx:TenantContext,unitId:string){
  const s=operationalScope(ctx,unitId,VIEW);
  return this.dep.operations.list(s.tenantId,s.unitId);
 }
 async get(ctx:TenantContext,unitId:string,orderId:string):Promise<OperationRecord>{
  const s=operationalScope(ctx,unitId,VIEW);
  validText(orderId,96);
  const item=await this.dep.operations.get(s.tenantId,s.unitId,orderId);
  if(!item)rejected('FULFILLMENT_NOT_FOUND','NOT_FOUND');
  return item!;
 }
 async release(ctx:TenantContext,unitId:string,orderId:string):Promise<OperationRecord>{
  const s=operationalScope(ctx,unitId,RELEASE);
  validText(orderId,96);
  const prior=await this.dep.operations.get(s.tenantId,s.unitId,orderId);
  if(prior)return prior;
  const now=this.clock().toISOString();
  const [order,profile,policy,catalog,payment]=await Promise.all([
   this.dep.orders.findById(s.tenantId,s.unitId,orderId),
   this.dep.profiles.effective(s.tenantId,s.unitId,now),
   this.dep.settings.get(s.tenantId,s.unitId),
   this.dep.catalog.effective(s.tenantId,s.unitId,now),
   this.dep.payments.byOrder(s.tenantId,s.unitId,orderId),
  ]);
  if(!order||order.status!=='CONFIRMED'||!order.customerConfirmation||
    order.productionState!=='NOT_DISPATCHED'||order.totalMinor<=0)
    rejected('FULFILLMENT_ORDER_NOT_CONFIRMED');
  if(!profile||!profile.capabilityRegistry.capabilities.includes('PRODUCTION')||
    (order.fulfillment.kind==='DELIVERY'&&!profile.capabilityRegistry.capabilities.includes('DELIVERY')))
    rejected('FULFILLMENT_CAPABILITY_DISABLED');
  if(!policy||!catalog||policy.operationMode!==order.operationMode||
    profile.capabilityRegistry.operationMode!==order.operationMode)
    rejected('FULFILLMENT_MODE_CHANGED');
  if(!payment||payment.tenantId!==order.tenantId||payment.unitId!==order.unitId||
    payment.orderId!==order.id||payment.customerId!==order.customerId||
    payment.amountMinor!==order.totalMinor)
    rejected('FULFILLMENT_PAYMENT_REQUIRED');
  const paid=payment.status==='CONFIRMED'&&order.paymentState==='CONFIRMED'&&
    ['PSP_GET','OPERATOR_COD'].includes(payment.verificationSource??'');
  const cod=payment.status==='PENDING'&&order.paymentState==='PENDING'&&
    ['CASH_ON_DELIVERY','CARD_ON_DELIVERY'].includes(payment.method);
  if(!paid&&!cod)rejected('FULFILLMENT_PAYMENT_NOT_SETTLED_OR_AUTHORIZED');
  if(order.fulfillment.kind==='DELIVERY'&&profile.capabilityRegistry.capabilities.includes('DELIVERY')!==true)
    rejected('FULFILLMENT_DELIVERY_DISABLED');
  const assessment=assessDelivery(order,policy,catalog);
  if(order.fulfillment.kind==='DELIVERY'&&assessment.kind!=='DELIVERY')
    rejected('FULFILLMENT_DELIVERY_NOT_VERIFIED');
  if(policy.operationMode==='INTEGRATED_OPERATIONS'){
    const adapter=policy.connectorId?this.dep.adapters.get(policy.connectorId):null;
    if(!adapter||adapter.schemaVersion!==1||
      !await adapter.readiness(s.tenantId,s.unitId))
      rejected('FULFILLMENT_CONNECTOR_NOT_VERIFIED','PROVIDER');
  }
  const operationState:OperationState=policy.operationMode==='NATIVE_OPERATIONS'?
    'QUEUED':'AWAITING_ACK';
  const projection=stateProjection(operationState,order.fulfillment.kind);
  const operation:OperationRecord={
    ...s,orderId:order.id,customerId:order.customerId,
    orderNumber:order.orderNumber,version:1,operationMode:order.operationMode,
    settingsVersion:policy.version,state:operationState,...projection,
    assessment,fulfillment:order.fulfillment,lines:order.lines,
    correlationId:id('correlation',order.tenantId,order.unitId,order.id),
    dispatchIdempotencyKey:id('kitchen-dispatch',order.tenantId,order.unitId,order.id),
    createdBy:ctx.userId!,createdAt:now,updatedAt:now,
    ...(policy.connectorId?{connectorId:policy.connectorId}:{}),
  };
  const initial=event(operation,
    operationState==='QUEUED'?'OrderReleasedToProduction':'ProductionDispatchRequested',
    ctx.userId!);
  return this.dep.operations.start(operation,initial,
    operationState==='AWAITING_ACK'?'DISPATCH':'CUSTOMER_NOTICE');
 }
 async advanceNative(ctx:TenantContext,unitId:string,orderId:string,input:unknown){
  keys(input,['expectedVersion','action']);
  const p=input as {expectedVersion?:number;action?:string};
  if(!Number.isSafeInteger(p.expectedVersion)||!['START','READY','DISPATCH_DELIVERY','COMPLETE'].includes(p.action??''))
    rejected('FULFILLMENT_TRANSITION_INVALID','VALIDATION');
  const allowed=p.action==='DISPATCH_DELIVERY'||p.action==='COMPLETE'?DELIVERY:KITCHEN;
  operationalScope(ctx,unitId,allowed);
  const before=await this.get(ctx,unitId,orderId);
  if(before.operationMode!=='NATIVE_OPERATIONS')
    rejected('FULFILLMENT_NATIVE_ACTION_FORBIDDEN','FORBIDDEN');
  const nextState:OperationState=p.action==='START'?'IN_PREPARATION':
    p.action==='READY'?'READY':p.action==='DISPATCH_DELIVERY'?'OUT_FOR_DELIVERY':'COMPLETED';
  if(!canAdvance(before.operationMode,before,nextState))
    rejected('FULFILLMENT_TRANSITION_FORBIDDEN');
  if(before.version!==p.expectedVersion)
    rejected('FULFILLMENT_VERSION_CONFLICT');
  const projection=stateProjection(nextState,before.fulfillment.kind);
  const updated:OperationRecord={...before,state:nextState,...projection,
    version:before.version+1,updatedAt:this.clock().toISOString()};
  const e=event(updated,eventFor(nextState,before.fulfillment.kind).name,ctx.userId!);
  return this.dep.operations.advance(updated,before.version,e,
    eventFor(nextState,before.fulfillment.kind).notify?'CUSTOMER_NOTICE':undefined);
 }
 /** Called ONLY by the worker after a configured connector returns an ACK. */
 async acknowledge(tenantId:string,unitId:string,orderId:string,ack:ProductionDispatchAck){
  const before=await this.dep.operations.get(tenantId,unitId,orderId);
  if(!before||before.operationMode!=='INTEGRATED_OPERATIONS'||
    !before.connectorId)rejected('FULFILLMENT_INTEGRATED_NOT_ACTIVE','FORBIDDEN');
  if(ack.schemaVersion!==1||!ack.accepted||ack.tenantId!==tenantId||
    ack.unitId!==unitId||ack.orderId!==orderId||
    ack.correlationId!==before.correlationId||
    ack.idempotencyKey!==before.dispatchIdempotencyKey||
    ack.connectorId!==before.connectorId||
    typeof ack.externalOrderId!=='string'||!ack.externalOrderId.trim()||
    ack.externalOrderId.length>128||!validText(ack.proofRef,200))
    rejected('FULFILLMENT_ACK_UNVERIFIED','FORBIDDEN');
  if(before.state==='QUEUED'&&before.externalOrderId===ack.externalOrderId)return before;
  if(before.state!=='AWAITING_ACK')rejected('FULFILLMENT_ACK_STATE_CONFLICT');
  const next:OperationRecord={...before,state:'QUEUED',
    ...stateProjection('QUEUED',before.fulfillment.kind),
    externalOrderId:ack.externalOrderId,version:before.version+1,
    updatedAt:this.clock().toISOString()};
  return this.dep.operations.advance(next,before.version,
    event(next,'OrderReleasedToProduction',before.connectorId),
    'CUSTOMER_NOTICE','ack:'+ack.externalOrderId);
 }
 /** The caller is a verified adapter, NEVER an internet-facing JSON route. */
 async verifiedExternalStatus(status:VerifiedProductionStatus):Promise<OperationRecord>{
  const before=await this.dep.operations.get(status.tenantId,status.unitId,status.orderId);
  if(!before||before.operationMode!=='INTEGRATED_OPERATIONS'||!before.externalOrderId||
    before.connectorId!==status.connectorId||before.externalOrderId!==status.externalOrderId||
    before.correlationId!==status.correlationId||!validText(status.proofRef,200)||
    !validText(status.providerEventId,128))
    rejected('FULFILLMENT_EXTERNAL_STATUS_UNVERIFIED','FORBIDDEN');
  // A provider may retry an earlier event after a newer event was applied.
  // Check the entire durable inbox, not just the most recent event ID.
  const inboxKey='external:'+status.connectorId+':'+status.providerEventId;
  if(before.lastVerifiedExternalEventId===status.providerEventId||
    await this.dep.operations.hasInbox(status.tenantId,status.unitId,status.orderId,inboxKey))
    return before;
  const nextState:OperationState=status.status==='OUT_FOR_DELIVERY'?
    'OUT_FOR_DELIVERY':status.status;
  const valid=(before.state==='QUEUED'&&nextState==='IN_PREPARATION')||
    (before.state==='IN_PREPARATION'&&nextState==='READY')||
    (before.state==='READY'&&(before.fulfillment.kind==='PICKUP'?
      nextState==='COMPLETED':nextState==='OUT_FOR_DELIVERY'))||
    (before.state==='OUT_FOR_DELIVERY'&&nextState==='COMPLETED');
  if(!valid)rejected('FULFILLMENT_EXTERNAL_SEQUENCE_INVALID');
  const next:OperationRecord={...before,state:nextState,
    ...stateProjection(nextState,before.fulfillment.kind),
    lastVerifiedExternalEventId:status.providerEventId,
    version:before.version+1,updatedAt:this.clock().toISOString()};
  const detail=eventFor(nextState,before.fulfillment.kind);
  return this.dep.operations.advance(next,before.version,
    event(next,detail.name,status.connectorId),
    detail.notify?'CUSTOMER_NOTICE':undefined,inboxKey);
 }
 async escalate(ctx:TenantContext,unitId:string,orderId:string,input:unknown){
  operationalScope(ctx,unitId,ADMIN);
  keys(input,['expectedVersion','reason']);
  const p=input as {expectedVersion?:number;reason?:string};
  const before=await this.get(ctx,unitId,orderId);
  if(before.operationMode!=='INTEGRATED_OPERATIONS'||before.state!=='AWAITING_ACK'||
    before.version!==p.expectedVersion)
    rejected('FULFILLMENT_ESCALATION_NOT_ALLOWED');
  const now=this.clock().toISOString();
  const after:OperationRecord={...before,state:'MANUAL_REVIEW_REQUIRED',
    ...stateProjection('MANUAL_REVIEW_REQUIRED',before.fulfillment.kind),
    version:before.version+1,updatedAt:now,
    escalation:{requestedBy:ctx.userId!,reason:validText(p.reason,240),at:now,
      manualDispatchAuthorized:false}};
  // This only records human review. It NEVER sends the order to a second
  // kitchen, since a timed-out external dispatch may already have been accepted.
  return this.dep.operations.markEscalation(after,before.version,
    event(after,'ProductionDispatchEscalated',ctx.userId!));
 }
 async dispatchPayload(operation:OperationRecord):Promise<ProductionDispatchEnvelope>{
  if(operation.operationMode!=='INTEGRATED_OPERATIONS'||operation.state!=='AWAITING_ACK')
    rejected('FULFILLMENT_DISPATCH_PAYLOAD_NOT_PENDING');
  return {schemaVersion:1,tenantId:operation.tenantId,unitId:operation.unitId,
    orderId:operation.orderId,orderNumber:operation.orderNumber,
    customerId:operation.customerId,correlationId:operation.correlationId,
    idempotencyKey:operation.dispatchIdempotencyKey,operationMode:'INTEGRATED_OPERATIONS',
    lines:operation.lines,fulfillment:operation.fulfillment};
 }
 /** The only supported route for provider notifications: an installed adapter
  * validates origin and constructs a trusted status. Not exposed as JSON API.
  */
 async verifyAndApply(connectorId:string,tenantId:string,unitId:string,raw:unknown){
  const adapter=this.dep.adapters.get(connectorId);
  if(!adapter)return rejected('FULFILLMENT_CONNECTOR_NOT_REGISTERED','FORBIDDEN');
  const verified=await adapter.verifyStatus(raw,tenantId,unitId);
  if(verified.connectorId!==connectorId||verified.tenantId!==tenantId||
    verified.unitId!==unitId)rejected('FULFILLMENT_CONNECTOR_SCOPE_INVALID','FORBIDDEN');
  return this.verifiedExternalStatus(verified);
 }
}
