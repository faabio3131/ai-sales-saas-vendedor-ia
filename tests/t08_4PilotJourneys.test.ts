import {describe,it,expect,vi} from 'vitest';
import type {Order,OrderRepository,CreateOrderInput} from '../src/orders/model';
import type {OrderPayment,OrderPaymentRepository,OrderPaymentEventKind,OutboxRecord} from '../src/orderPayments/model';
import type {ProviderPaymentRequest,ProviderPaymentResult} from '../src/payments/model';
import {OrderService} from '../src/orders/service';
import {OrderPaymentService} from '../src/orderPayments/service';
import {PaymentWebhookProcessor} from '../src/payments/providerWebhooks';
import {BusinessGroundingService} from '../src/business/grounding';
import {FinancialService} from '../src/finance/service';
import {FinanceQuestionService} from '../src/finance/questions';
import {parseSettings} from '../src/fulfillment/policy';
import {FulfillmentWorker} from '../src/fulfillment/worker';
import {ResilientAIRouter} from '../src/ai/resilientRouter';
import {catalogFixture,profiles,ctx as oc,NOW} from './helpers/t03Fixtures';
import {fixture as fulfillmentFixture,ctx as fc,config as fulfillmentConfig,sampleProfile} from './helpers/t06Fixtures';

const req=(kind:'PICKUP'|'DELIVERY'='PICKUP',idempotencyKey='pilot_order_req_001'):CreateOrderInput=>({
 customerId:'cust-a',idempotencyKey,expectedCatalogVersion:1,
 lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',flavorIds:['marg','calab'],
   borderId:'cat',addonIds:['bacon']}],
 fulfillment:kind==='PICKUP'?{kind:'PICKUP'}:
   {kind:'DELIVERY',zoneId:'centro',address:'Rua de Exemplo, 123, Centro, SP CEP 11700-000'},
});
const key=(...parts:string[])=>JSON.stringify(parts);

class Orders implements OrderRepository {
 readonly records=new Map<string,Order>();
 readonly dedupe=new Map<string,{id:string;fingerprint:string}>();
 readonly numbers=new Map<string,number>();
 async listByScope(t:string,u:string){return [...this.records.values()]
  .filter(o=>o.tenantId===t&&o.unitId===u).map(o=>structuredClone(o));}
 async findById(t:string,u:string,id:string){const o=this.records.get(id);
  return o&&o.tenantId===t&&o.unitId===u?structuredClone(o):null;}
 async findByIdempotency(t:string,u:string,k:string){
  const entry=this.dedupe.get(key(t,u,k));
  const order=entry?await this.findById(t,u,entry.id):null;
  return entry&&order?{order,fingerprint:entry.fingerprint}:null;
 }
 async createAtomic(draft:Order,k:string,fingerprint:string){
  const scope=key(draft.tenantId,draft.unitId);
  const old=this.dedupe.get(key(draft.tenantId,draft.unitId,k));
  if(old){
   if(old.fingerprint!==fingerprint)throw Object.assign(new Error('conflict'),{code:'ORDER_IDEMPOTENCY_CONFLICT'});
   return structuredClone(this.records.get(old.id)!);
  }
  const number=(this.numbers.get(scope)??0)+1;this.numbers.set(scope,number);
  const order={...draft,orderNumber:number,version:1};
  this.records.set(order.id,structuredClone(order));
  this.dedupe.set(key(draft.tenantId,draft.unitId,k),{id:order.id,fingerprint});
  return structuredClone(order);
 }
 async updateAtomic(next:Order,expected:number){
  const prev=this.records.get(next.id);
  if(!prev||prev.version!==expected||next.version!==expected+1||
     prev.tenantId!==next.tenantId||prev.unitId!==next.unitId)
   throw Object.assign(new Error('conflict'),{code:'ORDER_VERSION_CONFLICT'});
  this.records.set(next.id,structuredClone(next));return structuredClone(next);
 }
}
async function commerce(){
 const cat=await catalogFixture();
 const records=new Orders();
 const customers={findById:async(t:string,id:string)=>
  t==='pizza-a'&&id==='cust-a'?{id,tenantId:t,status:'ACTIVE',name:'Cliente',
   externalIdentities:[],createdAt:NOW,updatedAt:NOW}:null};
 const confirmation={verify:async(t:string,c:string,ref:string,id:string,amount:number)=>
  t==='pizza-a'&&c==='cust-a'&&ref==='verified:'+id+':'+amount};
 const settings={get:async(t:string,u:string)=>
  t==='pizza-a'&&u==='main'?parseSettings({tenantId:t,unitId:u},
    fulfillmentConfig(),'owner',NOW):null};
 const service=new OrderService(records,cat.repo,profiles,customers as never,confirmation,
   ()=>new Date(NOW),settings);
 return {service,records,cat};
}
async function confirmed(kind:'PICKUP'|'DELIVERY'='PICKUP'){
 const c=await commerce();
 const draft=await c.service.createDraft(oc(),'main',req(kind));
 const order=await c.service.confirm(oc(),'main',draft.id,{expectedVersion:draft.version,
  confirmation:{kind:'CUSTOMER_MESSAGE',totalMinor:draft.totalMinor,
   evidenceRef:'verified:'+draft.id+':'+draft.totalMinor}});
 return {...c,draft,order};
}
class Ledger implements OrderPaymentRepository{
 readonly entries=new Map<string,OrderPayment>();
 readonly eventLog:OutboxRecord[]=[];
 readonly paymentKeys=new Map<string,string>();
 constructor(private readonly orders:Orders){}
 async get(t:string,u:string,id:string){const e=this.entries.get(id);
  return e&&e.tenantId===t&&e.unitId===u?structuredClone(e):null;}
 async byOrder(t:string,u:string,id:string){const e=[...this.entries.values()]
  .find(p=>p.tenantId===t&&p.unitId===u&&p.orderId===id);
  return e?structuredClone(e):null;}
 async byIdempotency(t:string,u:string,id:string){const k=this.paymentKeys.get(key(t,u,id));
  return k?this.get(t,u,k):null;}
 async byProvider(t:string,p:string,id:string){const e=[...this.entries.values()]
  .find(x=>x.tenantId===t&&x.provider===p&&x.providerPaymentId===id);
  return e?structuredClone(e):null;}
 private log(p:OrderPayment,kind:OrderPaymentEventKind){
  this.eventLog.push({id:p.id+':'+p.version,tenantId:p.tenantId,unitId:p.unitId,
   orderId:p.orderId,paymentId:p.id,paymentVersion:p.version,kind,status:p.status,
   amountMinor:p.amountMinor,method:p.method,provider:p.provider,
   occurredAt:p.updatedAt,updatedAt:p.updatedAt,deliveryStatus:'PENDING',
   attemptCount:0,nextAttemptAt:0,leaseUntil:0,
   ...(p.verificationSource?{verificationSource:p.verificationSource}:{})});
 }
 async reserve(p:OrderPayment){
  const id=this.paymentKeys.get(key(p.tenantId,p.unitId,p.idempotencyKey));
  if(id)return {payment:structuredClone(this.entries.get(id)!),created:false};
  const order=this.orders.records.get(p.orderId);
  if(!order||order.tenantId!==p.tenantId||order.unitId!==p.unitId||
     order.status!=='CONFIRMED'||order.paymentState!=='NOT_REQUESTED'||
     order.totalMinor!==p.amountMinor)
   throw Object.assign(new Error('conflict'),{code:'ORDER_PAYMENT_NOT_CONFIRMABLE'});
  order.paymentState='PENDING';order.version++;
  this.entries.set(p.id,structuredClone(p));
  this.paymentKeys.set(key(p.tenantId,p.unitId,p.idempotencyKey),p.id);
  this.log(p,'PAYMENT_INTENT_RESERVED');
  return {payment:structuredClone(p),created:true};
 }
 async transition(next:OrderPayment,expected:number,kind:OrderPaymentEventKind){
  const before=this.entries.get(next.id);
  if(!before||before.version!==expected||next.version!==expected+1)
   throw Object.assign(new Error('conflict'),{code:'ORDER_PAYMENT_VERSION_CONFLICT'});
  this.entries.set(next.id,structuredClone(next));
  const order=this.orders.records.get(next.orderId);
  if(!order)throw new Error('fixture corrupt');
  const states:Record<string,Order['paymentState']>={
    CONFIRMED:'CONFIRMED',PENDING:'PENDING',EXPIRED:'EXPIRED',
    FAILED:'FAILED',REFUND_PENDING:'REFUND_PENDING',REFUNDED:'REFUNDED',
  };
  if(states[next.status])order.paymentState=states[next.status];
  order.version++;
  this.log(next,kind);
  return structuredClone(next);
 }
}
class FakePSP {
 readonly id='ASAAS';
 readonly supportedMethods=['PIX','PAYMENT_LINK','CHECKOUT'] as const;
 readonly providerPaymentId='pay_t084001';
 status:ProviderPaymentResult['status']='PENDING';
 calls={create:0,get:0};
 invalidAmount=false;timeout=false;
 private request?:ProviderPaymentRequest;
 async preflightPix(_input:ProviderPaymentRequest){}
 private response():ProviderPaymentResult{
  if(!this.request)throw new Error('PSP not initialized');
  return {provider:'ASAAS',providerPaymentId:this.providerPaymentId,status:this.status,
   amountMinor:this.request.amountMinor+(this.invalidAmount?5:0),
   referenceId:this.request.tenantId+':'+this.request.referenceId,
   pixCode:'00020101021226860014br.gov.bcb.pix',pixQrCodeBase64:'dGVzdA==',
   expiresAt:'2026-11-22T16:00:00.000Z'};
 }
 async createPix(input:ProviderPaymentRequest){
  this.calls.create++;this.request=input;
  if(this.timeout)throw Error('network timeout');
  return this.response();
 }
 async createCheckout(input:ProviderPaymentRequest){return this.createPix(input);}
 async createPaymentLink(input:ProviderPaymentRequest){return this.createPix(input);}
 async getPaymentStatus(_id:string){this.calls.get++;return this.response();}
 async refundPayment(_id:string){return this.response();}
 async cancelPayment(_id:string){return this.response();}
 async validateWebhook(){return false;}
 async normalizeWebhook(){throw Error('not used');}
}
async function paid(){
 const c=await confirmed();
 const ledger=new Ledger(c.records),psp=new FakePSP();
 const resolver={
   forNewPayment:async()=>psp,
   forRecordedPayment:async()=>psp,
 };
 const service=new OrderPaymentService(ledger,c.records,resolver as never,{} as never,
   undefined,()=>new Date(NOW));
 const created=await service.create(oc(),'main',c.order.id,{
  method:'PIX',providerId:'ASAAS',idempotencyKey:'pilot_pix_payment_01'});
 return {...c,ledger,psp,service,created};
}
function webhook(s:Awaited<ReturnType<typeof paid>>){
 const secret='test-asaas-secret-abcdef123456789';
 return {secret,processor:new PaymentWebhookProcessor({
  connections:{get:async(t:string)=>t==='pizza-a'?
   {tenantId:t,providerId:'ASAAS',recipientId:'merchant-receiver',
    credentialRef:'vault:test',status:'ACTIVE'}:null} as never,
  vault:{load:async()=>({tenantId:'pizza-a',providerId:'ASAAS',
   recipientId:'merchant-receiver',webhookSecret:secret})} as never,
  payments:{findByProviderPaymentId:async()=>null} as never,
  service:{refresh:async()=>{throw Error('legacy route forbidden');}} as never,
  orderPayments:s.ledger,orderService:s.service,
 })};
}
async function confirmPSP(s:Awaited<ReturnType<typeof paid>>){
 const {secret,processor}=webhook(s);
 const payload={id:'evt_test_t084001',payment:{id:s.psp.providerPaymentId,status:'RECEIVED'}};
 const rawBody=Buffer.from(JSON.stringify(payload));
 s.psp.status='CONFIRMED';
 const statuses=await processor.process({provider:'ASAAS',tenantId:'pizza-a',
  headers:{'asaas-access-token':secret},rawBody,payload});
 return {statuses,processor,secret,rawBody,payload};
}
function finance(orders:Orders,ledger:Ledger){
 const profile=sampleProfile('NATIVE_OPERATIONS');
 return new FinancialService({
  read:async(t:string,u:string)=>({
   orders:(await orders.listByScope(t,u)),
   events:ledger.eventLog.filter(e=>e.tenantId===t&&e.unitId===u),
  }),
 },{effective:async(t:string,u:string)=>t==='pizza-a'&&u==='main'?profile:null} as never,
 {get:async()=>null,update:async(v:unknown)=>v} as never,()=>new Date(Date.parse(NOW)+60_000));
}

describe('T08.4 — 10 jornadas obrigatórias verificadas sem ambiente externo',()=>{
 it('J01 ATENDIMENTO: fatos e catálogo versionados; não inventa horários ou preço de pizza',async()=>{
  const c=await catalogFixture();
  const p=sampleProfile('NATIVE_OPERATIONS');
  p.facts=[{id:'horarios',kind:'HOURS',question:'Qual o horario de atendimento?',
   answer:'Atendimento das 18h às 23h.',sourceRef:'operator-approved-fixture'}];
  const grounding=new BusinessGroundingService(
   {effective:async(t:string,u:string)=>t==='pizza-a'&&u==='main'?p:null} as never,
   {listByTenant:async()=>[]} as never,c.repo);
  const known=await grounding.answer(oc(),'main','Qual o horario de atendimento?',NOW);
  expect(known).toMatchObject({status:'ANSWERED',source:'BUSINESS_APPROVED',
   answer:'Atendimento das 18h às 23h.'});
  expect(known.evidenceIds).toHaveLength(1);
  expect((await grounding.answer(oc(),'main','Quanto custa pizza?',NOW)).status).toBe('UNKNOWN');
  expect((await grounding.answer(oc(),'main','Tem entrega por helicóptero?',NOW)).status).toBe('UNKNOWN');
  expect((await grounding.answer(oc('pizza-b'),'main','Qual o horario de atendimento?',NOW)).status).toBe('UNKNOWN');
 });
 it('J02 PEDIDO: 2 sabores, borda e adicional têm total determinístico; confirmação e sequência única',async()=>{
  const c=await commerce();
  const [one,two]=await Promise.all([c.service.createDraft(oc(),'main',req()),
   c.service.createDraft(oc(),'main',req())]);
  expect(one.id).toBe(two.id);
  expect(one.orderNumber).toBe(1);
  expect(one.lines[0]).toMatchObject({unitPriceMinor:7900,totalMinor:7900,
   halfHalfPricing:'MAX_FLAVOR'});
  expect(one.totalMinor).toBe(7900);
  await expect(c.service.confirm(oc(),'main',one.id,{expectedVersion:1,
    confirmation:{kind:'CUSTOMER_MESSAGE',totalMinor:7900,evidenceRef:'unverified'}}))
   .rejects.toMatchObject({code:'ORDER_CUSTOMER_CONFIRMATION_UNVERIFIED'});
  const approved=await c.service.confirm(oc(),'main',one.id,{expectedVersion:1,
   confirmation:{kind:'CUSTOMER_MESSAGE',totalMinor:7900,
    evidenceRef:'verified:'+one.id+':7900'}});
  expect(approved).toMatchObject({status:'CONFIRMED',version:2});
  expect((await c.service.createDraft(oc(),'main',req('PICKUP','pilot_order_req_002'))).orderNumber).toBe(2);
 });
 it('J03 ENTREGA: valida CEP, área, taxa e retirada antes de confirmar',async()=>{
  const c=await commerce();
  const delivery=await c.service.createDraft(oc(),'main',req('DELIVERY'));
  expect(delivery).toMatchObject({deliveryFeeMinor:600,totalMinor:8500,
   fulfillment:{kind:'DELIVERY',zoneId:'centro'}});
  await expect(c.service.createDraft(oc(),'main',{
    ...req('DELIVERY','pilot_bad_cep_002'),
    fulfillment:{kind:'DELIVERY',zoneId:'centro',address:'Rua A 10 CEP 11000-000'},
  })).rejects.toMatchObject({code:'FULFILLMENT_OUTSIDE_COVERAGE'});
  await expect(c.service.createDraft(oc(),'main',{
    ...req('DELIVERY','pilot_bad_addr_002'),
    fulfillment:{kind:'DELIVERY',zoneId:'centro',address:'Rua A sem CEP'},
  })).rejects.toMatchObject({code:'FULFILLMENT_ADDRESS_CEP_REQUIRED'});
  const pickup=await c.service.createDraft(oc(),'main',req('PICKUP','pilot_pickup_002'));
  expect(pickup).toMatchObject({deliveryFeeMinor:0,totalMinor:7900,fulfillment:{kind:'PICKUP'}});
 });
 it('J04 PIX: emissão mock, webhook autenticado, GET PSP, reentrega sem crédito duplo',async()=>{
  const s=await paid();
  expect(s.created).toMatchObject({method:'PIX',status:'PENDING',amountMinor:7900,
   pixCode:expect.stringContaining('000201'),pixQrCodeBase64:expect.any(String)});
  expect(s.psp.calls.create).toBe(1);
  const {processor,secret,payload,rawBody,statuses}=await confirmPSP(s);
  expect(statuses).toEqual(['CONFIRMED']);
  expect(s.psp.calls.get).toBe(1);
  const ok=await s.ledger.byOrder('pizza-a','main',s.order.id);
  expect(ok).toMatchObject({status:'CONFIRMED',verificationSource:'PSP_GET'});
  await expect(processor.process({provider:'ASAAS',tenantId:'pizza-a',
   headers:{'asaas-access-token':'wrong'},rawBody,payload}))
   .rejects.toMatchObject({code:'PAYMENT_WEBHOOK_UNAUTHORIZED'});
  await processor.process({provider:'ASAAS',tenantId:'pizza-a',
   headers:{'asaas-access-token':secret},rawBody,payload});
  expect(s.ledger.eventLog.filter(x=>x.kind==='PAYMENT_CONFIRMED')).toHaveLength(1);
  expect(s.psp.calls.create).toBe(1);
 });
 it('J05 PRODUÇÃO: só pedido confirmado com pagamento verificado; liberação única',async()=>{
  const s=await paid();
  const e=await fulfillmentFixture({kind:'PICKUP'});
  const k=e.operations.key('pizza-a','main',s.order.id);
  e.operations.orders.set(k,s.order);
  e.operations.payments.set(k,s.created);
  await expect(e.service.release(fc(),'main',s.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_PAYMENT_NOT_SETTLED_OR_AUTHORIZED'});
  await confirmPSP(s);
  const order=(await s.records.findById('pizza-a','main',s.order.id))!;
  e.operations.orders.set(k,order);
  e.operations.payments.set(k,(await s.ledger.byOrder('pizza-a','main',s.order.id))!);
  const [first,again]=await Promise.all([e.service.release(fc(),'main',s.order.id),
   e.service.release(fc(),'main',s.order.id)]);
  expect(first).toMatchObject({state:'QUEUED',operationMode:'NATIVE_OPERATIONS'});
  expect(again.version).toBe(first.version);
  expect(e.operations.events.filter(x=>x.name==='OrderReleasedToProduction')).toHaveLength(1);
  expect(e.pdv.kitchen.size).toBe(0);
 });
 it('J06 NOTIFICAÇÃO: confirmação, preparo, pronto e entrega somente de eventos duráveis',async()=>{
  const e=await fulfillmentFixture();
  await e.service.release(fc(),'main',e.order.id);
  for(const [action,version,role] of [
    ['START',1,'STAFF'],['READY',2,'STAFF'],
    ['DISPATCH_DELIVERY',3,'MANAGER'],['COMPLETE',4,'MANAGER']
  ] as const)await e.service.advanceNative(fc('pizza-a',role),'main',e.order.id,
   {expectedVersion:version,action});
  const op=await e.service.get(fc(),'main',e.order.id);
  const notices:string[]=[];
  const official={send:vi.fn(async(input:{tenantId:string;unitId:string;recipient:string;text:string;
   idempotencyKey:string;authorizedCustomerServiceWindow:boolean})=>{
    notices.push(input.text);
    expect(input).toMatchObject({tenantId:'pizza-a',unitId:'main',
      idempotencyKey:expect.any(String),authorizedCustomerServiceWindow:true});
    return {externalMessageId:'wamid.mockT084',duplicate:false};
  })};
  const port=new (await import('../src/fulfillment/notifications')).ChannelCustomerNoticePort(
   new (await import('../src/channels/service')).ChannelService([]),
   {findById:async()=>({tenantId:'pizza-a',id:op.customerId,
     name:'Cliente',phone:'5511999887766',status:'ACTIVE' as const,
     externalIdentities:[],createdAt:NOW,updatedAt:NOW})} as never,
   {get:async()=>({tenantId:'pizza-a',customerId:op.customerId,channel:'WHATSAPP' as const,
     recipient:'5511999887766',verifiedAt:NOW,provenance:'SIGNED_PROVIDER_WEBHOOK' as const,
     proofRef:'signed-wa-test-event'})},official);
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,port,
   ()=>Date.parse(NOW));
  expect(await worker.runOnce()).toMatchObject({claimed:5,delivered:5,retried:0});
  expect(notices).toHaveLength(5);
  expect(notices.join(' | ')).toContain('entrou em preparo');
  expect(notices.join(' | ')).toContain('saiu para entrega');
  expect(official.send.mock.calls).toHaveLength(5);
  expect(await worker.runOnce()).toMatchObject({claimed:0});
 });
 it('J07 FINANCEIRO: proprietário recebe dia/semana/mês com reconciliação e sem lucro inventado',async()=>{
  const s=await paid();await confirmPSP(s);
  const financial=finance(s.records,s.ledger);
  for(const period of ['day','week','month'] as const){
   const report=await financial.snapshot(oc(),'main',{period,anchor:'2026-11-21'});
   expect(report.metrics).toMatchObject({orderCount:1,grossSalesMinor:7900,
    netSalesMinor:7900,confirmedReceiptsMinor:7900,
    processingFeesMinor:null,netAfterProcessingFeesMinor:null});
   expect(report.reconciliation.errors).toBe(0);
  }
  const response=await new FinanceQuestionService(financial).ask(oc(),'main',
   {question:'Quanto recebi hoje?'});
  expect(response.answer).toContain('R$');
  await expect(financial.snapshot(oc('pizza-a','STAFF'),'main',{period:'day'}))
   .rejects.toMatchObject({code:'FINANCE_ADMIN_ACCESS_DENIED'});
 });
 it('J08 EXCEÇÕES: expiração, duplicação, preço divergente, edição e cancelamento',async()=>{
  const s=await paid();
  expect((await s.service.create(oc(),'main',s.order.id,{
   method:'PIX',providerId:'ASAAS',idempotencyKey:'pilot_pix_payment_01'})).id).toBe(s.created.id);
  expect(s.psp.calls.create).toBe(1);
  s.psp.invalidAmount=true;
  await expect(s.service.refresh(oc(),'main',s.created.id))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_PSP_RECONCILIATION_FAILED'});
  s.psp.invalidAmount=false;s.psp.status='EXPIRED';
  expect((await s.service.refresh(oc(),'main',s.created.id)).status).toBe('EXPIRED');
  await expect(s.service.refund(oc(),'main',s.order.id,{expectedVersion:3,reason:'cancelar'}))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_REFUND_NOT_ALLOWED'});
  await expect(s.service.get(oc('pizza-b'),'main',s.order.id))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_ORDER_NOT_FOUND'});
  await expect(s.service.create(oc(),'main',s.order.id,{
    method:'PIX',providerId:'ASAAS',idempotencyKey:'different_001'}))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_ALREADY_STARTED'});
  await expect(s.service.create(oc(),'main',s.order.id,{
    method:'PIX',providerId:'ASAAS',idempotencyKey:'pilot_pix_payment_01',
    payerEmail:'someone@example.test'}))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_IDEMPOTENCY_CONFLICT'});
  const fresh=await confirmed();
  await expect(fresh.service.updateDraft(oc(),'main',fresh.order.id,{
   expectedVersion:2,expectedCatalogVersion:1,lines:req().lines,fulfillment:{kind:'PICKUP'}}))
   .rejects.toMatchObject({code:'ORDER_NOT_EDITABLE'});
  expect((await fresh.service.cancel(oc(),'main',fresh.order.id,
   {expectedVersion:2,reason:'Solicitação registrada'})).status).toBe('CANCELLED');
 });
 it('J09 ISOLAMENTO: locatário/unidade e perfis diferentes não obtêm ordens ou saldos',async()=>{
  const s=await paid();await confirmPSP(s);
  const financial=finance(s.records,s.ledger);
  await expect(s.service.get(oc('pizza-b'),'main',s.order.id))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_ORDER_NOT_FOUND'});
  await expect(s.service.refresh(oc('pizza-b'),'main',s.created.id))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_NOT_FOUND'});
  await expect(s.service.get(oc(),'other-unit',s.order.id))
   .rejects.toMatchObject({code:'ORDER_PAYMENT_ORDER_NOT_FOUND'});
  await expect(financial.snapshot(oc('pizza-b'),'main',{period:'day'}))
   .rejects.toMatchObject({code:'FINANCE_BUSINESS_PROFILE_REQUIRED'});
  expect((await s.records.listByScope('pizza-b','main'))).toEqual([]);
  expect((await s.records.listByScope('pizza-a','other-unit'))).toEqual([]);
 });
 it('J10 RESILIÊNCIA: IA indisponível não inventa ação; ACK perdido não duplica produção',async()=>{
  const bad={id:'unreachable',supports:()=>true,
    generate:async()=>{throw new Error('secret internal provider token');}};
  const ai=new ResilientAIRouter([bad as never],{failureThreshold:1});
  const result=await ai.execute({tenantId:'pizza-a',capability:'GENERAL_REASONING',
    input:{question:'Pedido já foi entregue?'}});
  expect(result).toMatchObject({ok:false,error:{code:'AI_PROVIDER_UNAVAILABLE'}});
  expect(JSON.stringify(result)).not.toContain('secret internal provider token');
  const e=await fulfillmentFixture({mode:'INTEGRATED_OPERATIONS'});
  e.pdv.timeoutOnce=true;
  await e.service.release(fc(),'main',e.order.id);
  let time=Date.parse(NOW);
  const first=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,
   ()=>time);
  expect(await first.runOnce()).toEqual({claimed:1,delivered:0,retried:1});
  expect(e.pdv.kitchen.size).toBe(1);
  time+=31000;
  const restarted=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,
   ()=>time);
  expect(await restarted.runOnce()).toEqual({claimed:1,delivered:1,retried:0});
  expect(e.pdv.kitchen.size).toBe(1);
  expect(e.pdv.dispatchLog).toHaveLength(2);
  expect(e.pdv.dispatchLog[0].idempotencyKey).toBe(e.pdv.dispatchLog[1].idempotencyKey);
  expect(e.operations.events.filter(x=>x.name==='OrderReleasedToProduction')).toHaveLength(1);
 });
});
