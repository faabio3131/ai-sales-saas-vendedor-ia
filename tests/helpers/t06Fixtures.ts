import type {TenantContext} from '../../src/types/contracts';
import type {Order} from '../../src/orders/model';
import type {OrderPayment} from '../../src/orderPayments/model';
import type {BusinessProfileRevision} from '../../src/business/model';
import type {UnitCatalogRevision} from '../../src/commerce/model';
import type {ProductionAdapterRegistry,ProductionDispatchPort,ProductionDispatchEnvelope,
 ProductionDispatchAck,VerifiedProductionStatus,OperationRecord,OperationEvent,OperationRepository,
 UnitFulfillmentSettings,FulfillmentSettingsRepository,OperationOutboxRepository,
 OperationOutboxItem,CustomerNoticePort,UnitFulfillmentSettingsInput} from '../../src/fulfillment/model';
import {FulfillmentService} from '../../src/fulfillment/service';
export const NOW='2026-11-21T16:00:00.000Z';
export const ctx=(t='pizza-a',role='OWNER'):TenantContext=>({
 tenantId:t,userId:'operator',role,requestId:'test',
});
export const config=(mode:'NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS'='NATIVE_OPERATIONS'):
 UnitFulfillmentSettingsInput=>({
 expectedVersion:0,operationMode:mode,
 postalRanges:[{zoneId:'centro',fromCep:'11700000',toCep:'11799999'}],
 prepMinutes:30,deliveryMinutes:25,pickupMinutes:10,
 ...(mode==='INTEGRATED_OPERATIONS'?{connectorId:'PDV_CERTIFIED_TEST'}:{}),
});
export function sampleOrder(overrides:Partial<Order>={}):Order{
 return {id:'order_111111',tenantId:'pizza-a',unitId:'main',orderNumber:1,
  version:2,customerId:'customer_111',status:'CONFIRMED',currency:'BRL',
  catalogVersion:1,businessProfileVersion:1,operationMode:'NATIVE_OPERATIONS',
  lines:[{catalogItemId:'pizza',kind:'PIZZA',name:'Pizza Grande',quantity:1,
    unitPriceMinor:6600,totalMinor:6600,
    size:{id:'g',name:'Grande'},
    flavors:[{id:'calab',name:'Calabresa',priceMinor:6600}]}],
  fulfillment:{kind:'DELIVERY',zoneId:'centro',
    address:'Rua das Flores, 120, Centro, Praia Grande - SP. CEP 11700-000'},
  subtotalMinor:6600,deliveryFeeMinor:600,discountMinor:0,totalMinor:7200,
  paymentState:'CONFIRMED',productionState:'NOT_DISPATCHED',
  deliveryState:'NOT_STARTED',createdBy:'operator',createdAt:NOW,updatedAt:NOW,
  customerConfirmation:{kind:'CUSTOMER_MESSAGE',totalMinor:7200,
    evidenceRef:'conversation:some:msg',at:NOW,verifiedBy:'operator'},
  ...overrides};
}
export function samplePayment(order:Order,overrides:Partial<OrderPayment>={}):OrderPayment{
 return {id:'opay_111111',tenantId:order.tenantId,unitId:order.unitId,
  orderId:order.id,customerId:order.customerId,
  version:3,method:'PIX',status:'CONFIRMED',amountMinor:order.totalMinor,
  currency:'BRL',provider:'ASAAS',providerPaymentId:'pix_bank_111',
  idempotencyKey:'idem_111111',fingerprint:'fingerprint',
  createdAt:NOW,updatedAt:NOW,createdBy:'operator',
  confirmedAt:NOW,verificationSource:'PSP_GET',...overrides};
}
export function sampleProfile(mode:'NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS'):BusinessProfileRevision{
 return {
  tenantId:'pizza-a',unitId:'main',version:1,effectiveFrom:'2026-01-01T00:00:00.000Z',
  createdAt:NOW,createdBy:'owner',
  identity:{assistantName:'Assistente',voiceStyle:'FRIENDLY'},
  capabilityRegistry:{vertical:'FOOD_SERVICE',
    capabilities:['ORDERING','FOOD_SERVICE','PRODUCTION','DELIVERY'],
    operationMode:mode,integrationStatus:'NOT_CONFIGURED'},
  policy:{timezone:'America/Sao_Paulo',locale:'pt-BR',memoryRetentionDays:90,
    personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},
  facts:[],
 };
}
export function sampleCatalog():UnitCatalogRevision{
 return {tenantId:'pizza-a',unitId:'main',version:1,
  effectiveFrom:'2026-01-01T00:00:00.000Z',createdAt:NOW,createdBy:'owner',
  currency:'BRL',items:[],promotions:[],deliveryZones:[
    {id:'centro',name:'Centro',active:true,feeMinor:600},
    {id:'outside',name:'Fora',active:false,feeMinor:2500},
  ]};
}
function conflict(code:string):never{throw Object.assign(new Error(code),{code});}
export class MemorySettings implements FulfillmentSettingsRepository {
 readonly data=new Map<string,UnitFulfillmentSettings>();
 key(t:string,u:string){return JSON.stringify([t,u]);}
 async get(t:string,u:string){return this.data.get(this.key(t,u))??null;}
 async publish(next:UnitFulfillmentSettings,expectedVersion:number){
  const key=this.key(next.tenantId,next.unitId);
  const previous=this.data.get(key);
  if((previous?.version??0)!==expectedVersion)conflict('FULFILLMENT_SETTINGS_VERSION_CONFLICT');
  if(previous&&previous.operationMode!==next.operationMode&&previous.activeOperations)
   conflict('FULFILLMENT_MODE_ACTIVE_ORDERS');
  const result={...next,activeOperations:previous?.activeOperations??0};
  this.data.set(key,result);return result;
 }
}
export class MemoryOperations implements OperationRepository,OperationOutboxRepository {
 readonly operations=new Map<string,OperationRecord>();
 readonly orders=new Map<string,Order>();
 readonly payments=new Map<string,OrderPayment>();
 readonly events:OperationEvent[]=[];
 readonly jobs=new Map<string,OperationOutboxItem>();
 readonly inbox=new Set<string>();
 readonly settings:MemorySettings;
 private chain:Promise<void>=Promise.resolve();
 constructor(settings:MemorySettings){this.settings=settings;}
 key(t:string,u:string,o:string){return JSON.stringify([t,u,o]);}
 async exclusive<T>(fn:()=>Promise<T>|T):Promise<T>{
  let unlock!:()=>void;const gate=new Promise<void>(r=>{unlock=r;});
  const current=this.chain;this.chain=current.then(()=>gate);
  await current;
  try{return await fn();}finally{unlock();}
 }
 async get(t:string,u:string,o:string){
  const item=this.operations.get(this.key(t,u,o));
  return item?structuredClone(item):null;
 }
 async hasInbox(t:string,u:string,o:string,inboxKey:string){
  return this.inbox.has(this.key(t,u,o)+':'+inboxKey);
 }
 async list(t:string,u:string){
  return [...this.operations.values()].filter(x=>x.tenantId===t&&x.unitId===u)
    .map(x=>structuredClone(x));
 }
 async hasActive(t:string,u:string){
  return [...this.operations.values()].some(x=>x.tenantId===t&&x.unitId===u&&
    x.state!=='COMPLETED');
 }
 private pushEvent(e:OperationEvent,work?:'DISPATCH'|'CUSTOMER_NOTICE'){
  this.events.push(structuredClone(e));
  if(work)this.jobs.set(e.id,{...structuredClone(e),work,
    deliveryStatus:'PENDING',attemptCount:0,nextAttemptAt:0,leaseUntil:0});
 }
 async start(next:OperationRecord,e:OperationEvent,work:'DISPATCH'|'CUSTOMER_NOTICE'){
  return this.exclusive(async()=>{
   const key=this.key(next.tenantId,next.unitId,next.orderId);
   const existing=this.operations.get(key);
   if(existing)return structuredClone(existing);
   const order=this.orders.get(key),p=this.payments.get(key);
   const config=await this.settings.get(next.tenantId,next.unitId);
   if(!order||!p||!config||order.status!=='CONFIRMED'||
     order.operationMode!==next.operationMode||
     order.productionState!=='NOT_DISPATCHED'||config.version!==next.settingsVersion||
     p.amountMinor!==order.totalMinor||p.orderId!==order.id||
     p.tenantId!==order.tenantId||p.unitId!==order.unitId)
     conflict('FULFILLMENT_ORDER_NOT_RELEASABLE');
   const paid=order.paymentState==='CONFIRMED'&&p.status==='CONFIRMED'&&
     ['PSP_GET','OPERATOR_COD'].includes(p.verificationSource??'');
   const cod=order.paymentState==='PENDING'&&p.status==='PENDING'&&
     ['CASH_ON_DELIVERY','CARD_ON_DELIVERY'].includes(p.method);
   if(!paid&&!cod)conflict('FULFILLMENT_PAYMENT_NOT_SETTLED_OR_AUTHORIZED');
   this.operations.set(key,structuredClone(next));
   this.orders.set(key,{...order,version:order.version+1,
    productionState:next.productionState,deliveryState:next.deliveryState});
   this.settings.data.set(this.settings.key(next.tenantId,next.unitId),
    {...config,activeOperations:config.activeOperations+1});
   this.pushEvent(e,work);return structuredClone(next);
  });
 }
 async advance(next:OperationRecord,expected:number,e:OperationEvent,
  work?:'CUSTOMER_NOTICE',inboxKey?:string){
  return this.exclusive(async()=>{
   const key=this.key(next.tenantId,next.unitId,next.orderId);
   const old=this.operations.get(key),order=this.orders.get(key);
   const item=inboxKey?key+':'+inboxKey:null;
   if(item&&this.inbox.has(item)&&old)return structuredClone(old);
   if(!old||!order||old.version!==expected||next.version!==expected+1||
     old.operationMode!==next.operationMode)
     conflict('FULFILLMENT_OPERATION_VERSION_CONFLICT');
   this.operations.set(key,structuredClone(next));
   this.orders.set(key,{...order,version:order.version+1,
    productionState:next.productionState,deliveryState:next.deliveryState});
   if(next.state==='COMPLETED'){
    const settings=await this.settings.get(next.tenantId,next.unitId);
    if(!settings||settings.activeOperations<=0)conflict('FULFILLMENT_COUNTER');
    this.settings.data.set(this.settings.key(next.tenantId,next.unitId),
      {...settings,activeOperations:settings.activeOperations-1});
   }
   if(item)this.inbox.add(item);
   this.pushEvent(e,work);return structuredClone(next);
  });
 }
 async markEscalation(next:OperationRecord,v:number,event:OperationEvent){
  return this.advance(next,v,event);
 }
 async claim(now:number,limit:number){
  return this.exclusive(()=>{
   const selected:OperationOutboxItem[]=[];
   for(const [key,entry] of this.jobs){
    if(selected.length>=limit)break;
    if(!['PENDING','PROCESSING'].includes(entry.deliveryStatus)||
      entry.nextAttemptAt>now||entry.leaseUntil>now)continue;
    const next:OperationOutboxItem={...entry,deliveryStatus:'PROCESSING',
      claimToken:'claim-'+key,leaseUntil:now+120000};
    this.jobs.set(key,next);selected.push(structuredClone(next));
   }
   return selected;
  });
 }
 async ack(id:string,token:string,now:number){
  await this.exclusive(()=>{
   const item=this.jobs.get(id);
   if(item?.deliveryStatus==='PROCESSING'&&item.claimToken===token)
    this.jobs.set(id,{...item,deliveryStatus:'DELIVERED',leaseUntil:0,nextAttemptAt:now});
  });
 }
 async retry(id:string,token:string,now:number,code:string,maxAttempts:number){
  await this.exclusive(()=>{
   const item=this.jobs.get(id);
   if(item?.deliveryStatus!=='PROCESSING'||item.claimToken!==token)return;
   const attempts=item.attemptCount+1;
   this.jobs.set(id,{...item,deliveryStatus:attempts>=maxAttempts?'DLQ':'PENDING',
     attemptCount:attempts,leaseUntil:0,
     nextAttemptAt:attempts>=maxAttempts?Number.MAX_SAFE_INTEGER:now+30000,
     lastErrorCode:code});
  });
 }
}
export class FakePdv implements ProductionDispatchPort {
 readonly id='PDV_CERTIFIED_TEST';
 readonly schemaVersion=1;
 readonly kitchen=new Map<string,ProductionDispatchEnvelope>();
 readonly dispatchLog:ProductionDispatchEnvelope[]=[];
 healthy=true;timeoutOnce=false;private timedOut=false;
 async readiness(){return this.healthy;}
 async dispatch(envelope:ProductionDispatchEnvelope):Promise<ProductionDispatchAck>{
  this.dispatchLog.push(structuredClone(envelope));
  if(!this.kitchen.has(envelope.idempotencyKey))
    this.kitchen.set(envelope.idempotencyKey,structuredClone(envelope));
  if(this.timeoutOnce&&!this.timedOut){
   this.timedOut=true;throw new Error('Lost ACK after remote kitchen accepted');
  }
  return {schemaVersion:1,tenantId:envelope.tenantId,unitId:envelope.unitId,
   orderId:envelope.orderId,correlationId:envelope.correlationId,
   idempotencyKey:envelope.idempotencyKey,connectorId:this.id,
   accepted:true,externalOrderId:'pdv_external_1',proofRef:'signed-provider-ack-1'};
 }
 async verifyStatus(raw:unknown,t:string,u:string):Promise<VerifiedProductionStatus>{
  const item=raw as {signed?:boolean;payload?:VerifiedProductionStatus};
  if(item?.signed!==true||!item.payload||
    item.payload.tenantId!==t||item.payload.unitId!==u)
    conflict('UNVERIFIED_INTEGRATION_EVENT');
  return item.payload;
 }
}
export async function fixture(opts:{
 mode?:'NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS';
 kind?:'DELIVERY'|'PICKUP';paid?:boolean;cod?:boolean;
}={}){
 const mode=opts.mode??'NATIVE_OPERATIONS',kind=opts.kind??'DELIVERY';
 const settings=new MemorySettings(),operations=new MemoryOperations(settings);
 const pdv=new FakePdv();
 const adapters:ProductionAdapterRegistry={
  get:(id:string)=>id===pdv.id?pdv:null,
 };
 const profile=sampleProfile(mode),catalog=sampleCatalog();
 const order=sampleOrder({
  operationMode:mode,...(kind==='PICKUP'?{fulfillment:{kind:'PICKUP'},
    deliveryFeeMinor:0,totalMinor:6600,
    customerConfirmation:{kind:'CUSTOMER_MESSAGE',evidenceRef:'conv:123',totalMinor:6600,
      at:NOW,verifiedBy:'operator'}}:{}),
  ...(opts.paid===false?{paymentState:'PENDING' as const}:{}),
 });
 const payment=samplePayment(order,
   opts.paid===false?{status:'PENDING',method:opts.cod?'CASH_ON_DELIVERY':'PIX_MANUAL',
    verificationSource:undefined}: {});
 const key=operations.key(order.tenantId,order.unitId,order.id);
 operations.orders.set(key,order);operations.payments.set(key,payment);
 const deps={
  orders:{findById:async(t:string,u:string,o:string)=>
   structuredClone(operations.orders.get(operations.key(t,u,o))??null),
   listByScope:async(t:string,u:string)=>[...operations.orders.values()]
    .filter(o=>o.tenantId===t&&o.unitId===u)},
  payments:{byOrder:async(t:string,u:string,o:string)=>
   structuredClone(operations.payments.get(operations.key(t,u,o))??null)},
  profiles:{effective:async(t:string,u:string)=>
   t==='pizza-a'&&u==='main'?profile:null},
  catalog:{effective:async(t:string,u:string)=>
   t==='pizza-a'&&u==='main'?catalog:null},
  settings,operations,adapters,
 };
 const service=new FulfillmentService(deps,()=>new Date(NOW));
 const notices:OperationEvent[]=[];
 const sender:CustomerNoticePort={send:async e=>{notices.push(e);}};
 await service.publishSettings(ctx(),'main',config(mode));
 return {service,settings,operations,pdv,adapters,profile,catalog,order,payment,notices,sender,dep:deps};
}
