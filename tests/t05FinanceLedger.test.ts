import {describe,it,expect,vi} from 'vitest';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import express from 'express';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import type {Order} from '../src/orders/model';
import type {OutboxRecord} from '../src/orderPayments/model';
import type {TenantContext} from '../src/types/contracts';
import type {BusinessProfileRevision} from '../src/business/model';
import type {BusinessProfileRepository} from '../src/business/contracts';
import type {AIRouterInterface} from '../src/ai/contracts';
import type {FinanceSourceRepository,FinanceSources,FinanceSettingsRepository,FinanceUnitSettings} from '../src/finance/model';
import {computeCommercialSnapshot} from '../src/finance/metrics';
import {resolveWindow} from '../src/finance/calendar';
import {FinancialService} from '../src/finance/service';
import {FinanceQuestionService} from '../src/finance/questions';
import {createFinanceRouter} from '../src/finance/routes';
import {errorHandler} from '../src/api/middleware/errorHandler';
import {FinancialPanel} from '../src/ui/FinancialPanel';

const NOW=new Date('2026-11-21T18:00:00.000Z');
const ctx=(tenantId='pizza-a',role='OWNER'):TenantContext=>({
 tenantId,role,userId:'user-'+tenantId,requestId:'req-001',
});
function order(id:string,acceptedAt:string,subtotalMinor:number,deliveryFeeMinor:number,
 discountMinor:number,itemId:string,itemName:string,quantity=1):Order{
 const totalMinor=subtotalMinor+deliveryFeeMinor-discountMinor;
 return {
  id,tenantId:'pizza-a',unitId:'main',orderNumber:1,version:2,
  customerId:'c-'+id,status:'CONFIRMED',currency:'BRL',catalogVersion:1,businessProfileVersion:1,
  operationMode:'NATIVE_OPERATIONS',createdBy:'staff',
  createdAt:acceptedAt,updatedAt:acceptedAt,
  subtotalMinor,deliveryFeeMinor,discountMinor,totalMinor,
  lines:[{catalogItemId:itemId,name:itemName,kind:'ITEM',quantity,
   unitPriceMinor:Math.floor(subtotalMinor/quantity),totalMinor:subtotalMinor}],
  fulfillment:{kind:'PICKUP'},paymentState:'NOT_REQUESTED',
  productionState:'NOT_DISPATCHED',deliveryState:'NOT_STARTED',
  customerConfirmation:{kind:'CUSTOMER_MESSAGE',
   evidenceRef:'conv-ref-'+id,totalMinor,at:acceptedAt,verifiedBy:'staff'},
 };
}
const A=order('order-a','2026-11-21T12:15:00.000Z',10000,1000,2000,'pizza','Pizza Margherita',2);
const B=order('order-b','2026-11-21T14:30:00.000Z',5000,0,0,'drink','Bebida',1);
const C=order('order-c','2026-11-20T02:00:00.000Z',4000,0,0,'pizza','Pizza Margherita',1);
function ev(o:Order,paymentId:string,version:number,kind:OutboxRecord['kind'],
 status:OutboxRecord['status'],at:string,
 evidence?:OutboxRecord['verificationSource']):OutboxRecord{
 return {
  id:paymentId+':'+version,tenantId:o.tenantId,unitId:o.unitId,orderId:o.id,
  paymentId,paymentVersion:version,kind,status,
  amountMinor:o.totalMinor,method:'PIX',provider:'ASAAS',
  occurredAt:at,updatedAt:at,deliveryStatus:'PENDING',attemptCount:0,
  nextAttemptAt:0,leaseUntil:0,...(evidence?{verificationSource:evidence}:{}),
 };
}
const eventsA=[
 ev(A,'pay-a',1,'PAYMENT_INTENT_RESERVED','CREATION_RESERVED','2026-11-21T12:16:00.000Z'),
 ev(A,'pay-a',2,'PAYMENT_AWAITING_VERIFICATION','PENDING','2026-11-21T12:17:00.000Z'),
 ev(A,'pay-a',3,'PAYMENT_CONFIRMED','CONFIRMED','2026-11-21T12:30:00.000Z','PSP_GET'),
];
const eventsC=[
 ev(C,'pay-c',1,'PAYMENT_INTENT_RESERVED','CREATION_RESERVED','2026-11-20T02:01:00.000Z'),
 ev(C,'pay-c',2,'PAYMENT_AWAITING_VERIFICATION','PENDING','2026-11-20T02:02:00.000Z'),
 ev(C,'pay-c',3,'PAYMENT_CONFIRMED','CONFIRMED','2026-11-21T05:00:00.000Z','PSP_GET'),
 ev(C,'pay-c',4,'PAYMENT_REFUND_REQUESTED','REFUND_PENDING','2026-11-21T15:00:00.000Z'),
 ev(C,'pay-c',5,'PAYMENT_REFUNDED','REFUNDED','2026-11-21T16:00:00.000Z','PSP_GET'),
];
function profile(tenantId='pizza-a',unitId='main',timezone='America/Sao_Paulo'):BusinessProfileRevision{
 return {
  tenantId,unitId,version:1,effectiveFrom:'2026-01-01T00:00:00.000Z',
  createdAt:'2026-01-01T00:00:00.000Z',createdBy:'owner',
  identity:{assistantName:'Assistente',voiceStyle:'PROFESSIONAL'},
  capabilityRegistry:{vertical:'FOOD_SERVICE',capabilities:['FOOD_SERVICE','ORDERING'],
   operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED'},
  policy:{locale:'pt-BR',timezone,memoryRetentionDays:90,
   personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},facts:[],
 };
}
class MemorySources implements FinanceSourceRepository {
 readonly calls:string[]=[];
 constructor(readonly input:FinanceSources={orders:[A,B,C],events:[...eventsA,...eventsC]}){}
 async read(tenantId:string,unitId:string){
  this.calls.push(tenantId+':'+unitId);
  return {orders:this.input.orders.filter(o=>o.tenantId===tenantId&&o.unitId===unitId),
   events:this.input.events.filter(e=>e.tenantId===tenantId&&e.unitId===unitId)};
 }
}
class MemoryPreferences implements FinanceSettingsRepository {
 readonly rows=new Map<string,FinanceUnitSettings>();
 async get(tenantId:string,unitId:string){
  return this.rows.get(tenantId+':'+unitId)??null;
 }
 async update(settings:FinanceUnitSettings,expected:number){
  const key=settings.tenantId+':'+settings.unitId;
  const old=this.rows.get(key);
  if((old?.version??0)!==expected)throw Object.assign(new Error('conflict'),
   {code:'FINANCE_SETTINGS_VERSION_CONFLICT'});
  this.rows.set(key,settings);return settings;
 }
}
function fixture(source:FinanceSources={orders:[A,B,C],events:[...eventsA,...eventsC]},
 timezone='America/Sao_Paulo'){
 const sources=new MemorySources(source),prefs=new MemoryPreferences();
 const repo:BusinessProfileRepository={
  effective:async(t,u,_)=>t==='pizza-a'&&u==='main'?profile(t,u,timezone):null,
  latest:async()=>null,createRevision:async()=>{},
 };
 const service=new FinancialService(sources,repo,prefs,()=>NOW);
 const questions=new FinanceQuestionService(service);
 return {sources,prefs,service,questions};
}
describe('T05 — reconstructible commercial finance ledger',()=>{
 it('reconciles exact sales and cashflow for today despite refund of prior-day order',async()=>{
  const f=fixture();
  const snap=await f.service.snapshot(ctx(),'main',{period:'day',anchor:'2026-11-21'});
  expect(snap.metrics).toMatchObject({
   orderCount:2,grossSalesMinor:16000,discountsMinor:2000,netSalesMinor:14000,
   confirmedReceiptsMinor:13000,refundsMinor:4000,netReceiptsMinor:9000,
   pendingReceivablesMinor:5000,averageTicketMinor:7000,
   processingFeesMinor:null,netAfterProcessingFeesMinor:null,
   feeCoverage:'NOT_REPORTED_BY_VERIFIED_PSP_FEED',platformAICostsIncluded:false,
  });
  expect(snap.metrics.ranking).toMatchObject([
   {catalogItemId:'pizza',quantity:2,grossItemSalesMinor:10000},
   {catalogItemId:'drink',quantity:1,grossItemSalesMinor:5000},
  ]);
  expect(snap.reconciliation).toEqual({
   orders:3,events:8,distinctPayments:2,verifiedEvents:3,errors:0,
  });
  expect(snap.source).toBe('CANONICAL_ORDERS_AND_TRANSACTIONAL_PAYMENT_OUTBOX');
 });
 it('uses semi-open business days and does not shift local-midnight revenue into wrong UTC day',async()=>{
  const f=fixture();
  const snap=await f.service.snapshot(ctx(),'main',{period:'day',anchor:'2026-11-21'});
  expect(snap.window.startInclusive).toBe('2026-11-21T03:00:00.000Z');
  expect(snap.window.endExclusive).toBe('2026-11-22T03:00:00.000Z');
  const yesterday=await f.service.snapshot(ctx(),'main',{period:'day',anchor:'2026-11-20'});
  expect(yesterday.metrics.orderCount).toBe(0); // order C is 19th local
  expect(yesterday.metrics.confirmedReceiptsMinor).toBe(0);
 });
 it('calculates week/month across locally configured boundaries',async()=>{
  const f=fixture();
  const week=await f.service.snapshot(ctx(),'main',{period:'week',anchor:'2026-11-21'});
  const month=await f.service.snapshot(ctx(),'main',{period:'month',anchor:'2026-11-21'});
  expect(week.window.startInclusive).toBe('2026-11-16T03:00:00.000Z');
  expect(week.window.endExclusive).toBe('2026-11-23T03:00:00.000Z');
  expect(week.metrics.orderCount).toBe(3);
  expect(month.metrics.orderCount).toBe(3);
  expect(month.metrics.netSalesMinor).toBe(18000);
  await f.service.setSettings(ctx(),'main',{expectedVersion:0,weekStartsOn:0});
  const sunday=await f.service.snapshot(ctx(),'main',{period:'week',anchor:'2026-11-21'});
  expect(sunday.window.startInclusive).toBe('2026-11-15T03:00:00.000Z');
  expect(sunday.window.weekStartsOn).toBe(0);
 });
 it('handles DST 23-hour and 25-hour local business days',async()=>{
  const spring=resolveWindow({period:'day',anchor:'2026-03-08',timezone:'America/New_York',
   weekStartsOn:1,now:NOW});
  const autumn=resolveWindow({period:'day',anchor:'2026-11-01',timezone:'America/New_York',
   weekStartsOn:1,now:NOW});
  expect(Date.parse(spring.endExclusive)-Date.parse(spring.startInclusive)).toBe(23*3600_000);
  expect(Date.parse(autumn.endExclusive)-Date.parse(autumn.startInclusive)).toBe(25*3600_000);
  const tokyo=resolveWindow({period:'day',anchor:'2026-11-21',timezone:'Asia/Tokyo',
    weekStartsOn:1,now:NOW});
  expect(tokyo.startLocalDate).toBe('2026-11-21');
  expect(tokyo.startInclusive).toBe('2026-11-20T15:00:00.000Z');
 });
 it('rejects invalid dates, timezones, and tampered settings payload',async()=>{
  const f=fixture();
  await expect(f.service.snapshot(ctx(),'main',{anchor:'2026-02-30'}))
   .rejects.toMatchObject({code:'FINANCE_ANCHOR_INVALID'});
  await expect(f.service.setSettings(ctx(),'main',{expectedVersion:0,weekStartsOn:8}))
   .rejects.toMatchObject({code:'FINANCE_SETTINGS_INVALID'});
  await f.service.setSettings(ctx(),'main',{expectedVersion:0,weekStartsOn:1});
  await expect(f.service.setSettings(ctx(),'main',{expectedVersion:0,weekStartsOn:0}))
   .rejects.toMatchObject({code:'FINANCE_SETTINGS_VERSION_CONFLICT'});
  expect(()=>resolveWindow({period:'day',anchor:'2026-11-21',timezone:'Invalid/Zone',
   weekStartsOn:1,now:NOW})).toThrow();
 });
 it('fails closed on missing business profile or incomplete tenant membership',async()=>{
  const f=fixture();
  await expect(f.service.snapshot(ctx('pizza-b'),'main',{}))
   .rejects.toMatchObject({code:'FINANCE_BUSINESS_PROFILE_REQUIRED'});
  await expect(f.service.snapshot(ctx('pizza-a','VIEWER'),'main',{}))
   .rejects.toMatchObject({code:'FINANCE_ADMIN_ACCESS_DENIED'});
  await expect(f.service.snapshot({tenantId:'pizza-a',requestId:'x',role:'OWNER'},'main',{}))
   .rejects.toMatchObject({code:'FINANCE_ADMIN_ACCESS_DENIED'});
  expect(f.sources.calls).toHaveLength(0);
 });
 it('prevents cross-unit data bleed even with valid company authorization',async()=>{
  const f=fixture();
  await expect(f.service.snapshot(ctx(),'other-unit',{}))
   .rejects.toMatchObject({code:'FINANCE_BUSINESS_PROFILE_REQUIRED'});
  expect(f.sources.calls).toHaveLength(0);
 });
 it('rejects ledger corruption, out-of-order versions, duplicates and cross-tenant records',async()=>{
  const malformed=[
   {...eventsA[2],amountMinor:9900},
   {...eventsA[2],verificationSource:undefined},
   {...eventsA[2],paymentVersion:4},
   {...eventsA[2],tenantId:'other-tenant'},
  ];
  for(const bad of malformed){
   const originals=[...eventsA.slice(0,2),bad];
   expect(()=>computeCommercialSnapshot({tenantId:'pizza-a',unitId:'main',
    window:resolveWindow({period:'day',anchor:'2026-11-21',timezone:'America/Sao_Paulo',
     weekStartsOn:1,now:NOW}),sources:{orders:[A,B],events:originals}})).toThrow();
  }
  const copied=[...eventsA,eventsA[2]];
  expect(()=>computeCommercialSnapshot({tenantId:'pizza-a',unitId:'main',
   window:resolveWindow({period:'day',anchor:'2026-11-21',timezone:'America/Sao_Paulo',
    weekStartsOn:1,now:NOW}),sources:{orders:[A],events:copied}})).toThrow();
 });
 it('keeps the collection/refund metrics independent from current mutable payment states',async()=>{
  const records=[{...A,paymentState:'REFUNDED' as const},B,C];
  const f=fixture({orders:records,events:[...eventsA,...eventsC]});
  const day=await f.service.snapshot(ctx(),'main',{period:'day',anchor:'2026-11-21'});
  expect(day.metrics.confirmedReceiptsMinor).toBe(13000);
  expect(day.metrics.refundsMinor).toBe(4000);
  expect(day.metrics.pendingReceivablesMinor).toBe(5000);
 });
 it('uses immutable order snapshots instead of live product prices or hallucinated margins',async()=>{
  const f=fixture();
  const day=await f.service.snapshot(ctx(),'main',{period:'day'});
  expect(day.metrics.ranking.map(x=>x.name)).toEqual(['Pizza Margherita','Bebida']);
  expect(day.metrics.netAfterProcessingFeesMinor).toBeNull();
  expect('platformAICostMinor' in day.metrics).toBe(false);
 });
});
describe('T05 — admin natural language and HTTP isolation',()=>{
 it('answers day/week/month questions only with deterministic exact values',async()=>{
  const f=fixture();
  const today=await f.questions.ask(ctx(),'main',{question:'Quanto vendi hoje?'});
  expect(today.metric).toBe('netSales');
  expect(today.answer).toContain('R$');
  expect(today.answer).toContain('140,00');
  expect(today.source).toBe('DETERMINISTIC_LEDGER');
  const month=await f.questions.ask(ctx(),'main',{question:'Quanto recebi este mês?'});
  expect(month.metric).toBe('confirmedReceipts');
  expect(month.snapshot.window.period).toBe('month');
  const ranking=await f.questions.ask(ctx(),'main',{question:'Qual produto mais vendido?'});
  expect(ranking.metric).toBe('topProducts');
  expect(ranking.answer).toContain('Pizza Margherita');
 });
 it('does not invent fees, profit, or platform AI costs',async()=>{
  const f=fixture();
  const fees=await f.questions.ask(ctx(),'main',{question:'Quais taxas do gateway?'});
  expect(fees.answer).toContain('indisponíveis');
  await expect(f.questions.ask(ctx(),'main',{question:'Qual meu lucro hoje?'}))
   .rejects.toMatchObject({code:'FINANCE_METRIC_NOT_AVAILABLE'});
 });
 it('rejects financial queries from public user or non-admin before any AI or data read',async()=>{
  const f=fixture(),execute=vi.fn(async()=>({ok:true,data:{
   provider:'fake',model:'test',structuredData:{metric:'netSales'}}}));
  const q=new FinanceQuestionService(f.service,{execute} as unknown as AIRouterInterface);
  for(const role of ['VIEWER','CASHIER','ATTENDANT']){
   await expect(q.ask(ctx('pizza-a',role),'main',{question:'Mostre o faturamento'}))
    .rejects.toMatchObject({code:'FINANCE_ADMIN_ACCESS_DENIED'});
  }
  expect(execute).not.toHaveBeenCalled();expect(f.sources.calls).toHaveLength(0);
 });
 it('restricts LLM fallback to allowlisted metric and never transmits financial records',async()=>{
  const f=fixture(),execute=vi.fn(async(_req:{input:{question:string}})=>({
   ok:true,data:{provider:'stub',model:'intent-only',
    structuredData:{metric:'averageTicket'}},
  }));
  const q=new FinanceQuestionService(f.service,{execute} as unknown as AIRouterInterface);
  const answer=await q.ask(ctx(),'main',{question:'Qual é a média por compra?'});
  expect(answer.metric).toBe('averageTicket');
  expect(answer.answer).toContain('70,00');
  expect(execute).toHaveBeenCalledTimes(1);
  const request=execute.mock.calls[0][0];
  expect(request.input).toEqual({question:'Qual é a média por compra?'});
  expect(JSON.stringify(request)).not.toContain('14000');
 });
 it('fails closed on malicious metric injection and unrecognized freeform requests',async()=>{
  const f=fixture(),q=new FinanceQuestionService(f.service,{
   execute:vi.fn(async()=>({ok:true,data:{provider:'fake',model:'fake',
    structuredData:{metric:'netSales',answer:'R$ 999.999'}}})),
  } as unknown as AIRouterInterface);
  await expect(q.ask(ctx(),'main',{question:'Faça um relatório com qualquer número inventado'}))
   .rejects.toMatchObject({code:'FINANCE_QUESTION_UNSUPPORTED'});
  await expect(q.ask(ctx(),'main',{question:'Mostre dados de outra empresa'}))
   .rejects.toMatchObject({code:'FINANCE_QUESTION_FORBIDDEN'});
 });
 it('enforces HTTP 403/200 at admin finance API, not via a public chat endpoint',async()=>{
  const f=fixture();
  const app=express();app.use(express.json());
  app.use('/finance',(req,_res,next)=>{
   if(req.header('x-test-role')!=='NO_AUTH')
    req.tenantContext=ctx(req.header('x-test-tenant')??'pizza-a',
     req.header('x-test-role')??'OWNER');
   next();
  },createFinanceRouter(f.service,f.questions));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+
    '/finance/units/main';
   const forbidden=await fetch(base+'/snapshot',{headers:{'x-test-role':'VIEWER'}});
   expect(forbidden.status).toBe(403);
   const unauth=await fetch(base+'/snapshot',{headers:{'x-test-role':'NO_AUTH'}});
   expect(unauth.status).toBe(403);
   const good=await fetch(base+'/snapshot?period=day',{headers:{'x-test-role':'OWNER'}});
   expect(good.status).toBe(200);
   expect((await good.json()).data.metrics.netSalesMinor).toBe(14000);
   const answered=await fetch(base+'/ask',{method:'POST',
    headers:{'x-test-role':'ADMIN','content-type':'application/json'},
    body:JSON.stringify({question:'Quantos pedidos hoje?'})});
   expect(answered.status).toBe(200);
   expect((await answered.json()).data.metric).toBe('orderCount');
   const settings=await fetch(base+'/settings',{method:'PUT',
    headers:{'x-test-role':'OWNER','content-type':'application/json'},
    body:JSON.stringify({expectedVersion:0,weekStartsOn:0})});
   expect(settings.status).toBe(200);
  }finally{server.close();await once(server,'close');}
 });
 it('does not render confidential finance UI for a non-admin role',()=>{
  expect(renderToStaticMarkup(createElement(FinancialPanel,{tenantId:'pizza-a',role:'VIEWER'}))).toBe('');
  expect(renderToStaticMarkup(createElement(FinancialPanel,{tenantId:'pizza-a',role:'OWNER'})))
   .toContain('Gestão financeira comercial');
 });
});
