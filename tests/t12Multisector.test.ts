import {describe,it,expect,vi} from 'vitest';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import express from 'express';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RetailPaymentService} from '../src/retail/payment';
import {createRetailRouter} from '../src/retail/routes';
import {errorHandler} from '../src/api/middleware/errorHandler';
import {MultiSectorOnboarding,onboardingTemplates} from '../src/onboarding/service';
import {planAllows,activePlan} from '../src/retail/plan';
import {summarize} from '../src/onboarding/report';
import {BusinessGroundingService} from '../src/business/grounding';
import type {CatalogRepository} from '../src/catalog/contracts';
import type {Order} from '../src/orders/model';
import type {Booking} from '../src/scheduling/model';
import type {OnboardingRecord} from '../src/onboarding/model';
import type {Subscription} from '../src/plans/model';
import type {PaymentProviderInterface} from '../src/payments/contracts';
import type {ProviderPaymentRequest,ProviderPaymentResult} from '../src/payments/model';
import {RetailPanel,MultisectorOnboardingPanel} from '../src/ui/MultisectorPanel';
import {actor,BASE} from './t10ScheduleSupport';
import {packFixture,packInput} from './t11PackSupport';
import {cartInput,confirmInput,products,retailFixture} from './t12RetailSupport';

export const onboardingInput=(templateId='retail',mode='NATIVE_OPERATIONS')=>({templateId,mode,businessName:'Empresa teste',assistantName:'Assistente teste',timezone:'America/Sao_Paulo',memoryRetentionDays:90,contact:'5511990000000',address:'Rua de teste, 123',hours:'Segunda a sábado',reason:'Configuração autorizada'});
function subscription(planCode:Subscription['planCode']='STANDARD'):Subscription{return {id:'sub',tenantId:'tenant-a',planCode,status:'ACTIVE',periodStart:'2020-01-01T00:00:00Z',periodEnd:'2099-01-01T00:00:00Z',createdAt:'x',updatedAt:'x'};}
function payment(){
 let request:ProviderPaymentRequest|undefined,paid=false,wrong=false;
 const result=():ProviderPaymentResult=>({provider:'ASAAS',providerPaymentId:'psp-retail',referenceId:request!.tenantId+':'+request!.referenceId,amountMinor:request!.amountMinor+(wrong?1:0),status:paid?'CONFIRMED':'PENDING',pixCode:'test-pix'});
 const createPix=vi.fn(async(r:ProviderPaymentRequest)=>{request=r;return result();});
 const getPaymentStatus=vi.fn(async(_id:string)=>result());
 const adapter={id:'ASAAS',createPix,getPaymentStatus} as unknown as PaymentProviderInterface;
 return {adapter,createPix,getPaymentStatus,paid:()=>{paid=true;},wrong:()=>{wrong=true;}};
}
describe('T12 commerce lifecycle',()=>{
 it('canonical pricing rejects client amounts, duplicates and cross-tenant customer',async()=>{
  const h=await retailFixture();
  await expect(h.service.createCart(h.ctx,h.u,{...cartInput(),totalMinor:1})).rejects.toMatchObject({code:'SCHEDULE_FIELDS_INVALID'});
  await expect(h.service.createCart(h.ctx,h.u,{...cartInput(),lines:[{itemId:'sku-a',quantity:1},{itemId:'sku-a',quantity:2}]})).rejects.toMatchObject({code:'RETAIL_DUPLICATE_LINE'});
  await expect(h.service.createCart(h.ctx,h.u,{...cartInput(),customerId:'customer-tenant-b'})).rejects.toMatchObject({code:'RETAIL_CUSTOMER_INVALID'});
  const b=await h.service.createCart(h.ctx,h.u,cartInput('tenant-a','cart',2));
  expect(b.totalMinor).toBe(10000);expect(b.status).toBe('CART');expect((await h.service.inventory(h.ctx,h.u))[0].stock.reserved).toBe(0);
  expect(await h.service.createCart(h.ctx,h.u,cartInput('tenant-a','cart',2))).toEqual(b);
  await expect(h.service.createCart(h.ctx,h.u,cartInput('tenant-a','cart',1))).rejects.toMatchObject({code:'RETAIL_IDEMPOTENCY_CONFLICT'});
 });
 it('race for last 2 stock units has a single winner, atomic reserve and exact release',async()=>{
  const h=await retailFixture();
  const rows=await Promise.all(Array.from({length:12},(_,i)=>h.service.createCart(h.ctx,h.u,cartInput('tenant-a','cart-'+i,2))));
  const confirmations=await Promise.allSettled(rows.map((b,i)=>h.service.confirm(h.ctx,h.u,b.id,confirmInput(1,10000,'confirm-'+i))));
  expect(confirmations.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const winner=confirmations.find(r=>r.status==='fulfilled')!;if(winner.status!=='fulfilled')throw Error();
  expect((await h.service.inventory(h.ctx,h.u))[0].stock).toMatchObject({onHand:2,reserved:2});
  await expect(h.service.adjust(h.ctx,h.u,'sku-a',{expectedVersion:2,onHand:1,reason:'Inventário'})).rejects.toMatchObject({code:'RETAIL_STOCK_VERSION_OR_RESERVATION'});
  await expect(h.service.publish(h.ctx,h.u,{expectedVersion:1,items:products})).rejects.toMatchObject({code:'RETAIL_ACTIVE_ORDERS_BLOCK_CATALOG'});
  const req={expectedVersion:2,idempotencyKey:'cancel',reason:'Cliente cancelou'};
  const cancelled=await h.service.cancel(h.ctx,h.u,winner.value.id,req);
  expect(await h.service.cancel(h.ctx,h.u,cancelled.id,req)).toEqual(cancelled);
  expect((await h.service.inventory(h.ctx,h.u))[0].stock).toMatchObject({onHand:2,reserved:0});
 });
 it('cart revision reprices from catalog, stale cart cannot confirm; manual payment distinctly attested, stock consumed once',async()=>{
  const h=await retailFixture(),b=await h.service.createCart(h.ctx,h.u,cartInput());
  await h.service.publish(h.ctx,h.u,{expectedVersion:1,items:products.map(p=>p.id==='sku-a'?{...p,priceMinor:6000}:p)});
  await expect(h.service.confirm(h.ctx,h.u,b.id,confirmInput())).rejects.toMatchObject({code:'RETAIL_CATALOG_VERSION_CONFLICT'});
  const edit=await h.service.editCart(h.ctx,h.u,b.id,{expectedVersion:1,idempotencyKey:'edit',expectedCatalogVersion:2,lines:[{itemId:'sku-a',quantity:1}]});
  expect(edit.totalMinor).toBe(6000);
  const c=await h.service.confirm(h.ctx,h.u,b.id,confirmInput(2,6000));
  await expect(h.service.complete(h.ctx,h.u,c.id,{expectedVersion:3,idempotencyKey:'unpaid'})).rejects.toMatchObject({code:'RETAIL_SETTLEMENT_REQUIRED'});
  const req={expectedVersion:3,idempotencyKey:'manual',method:'CASH',amountMinor:6000,evidenceRef:'Caixa-123'};
  await expect(h.service.recordManual(actor('tenant-a','ATTENDANT'),h.u,c.id,req)).rejects.toMatchObject({code:'RETAIL_PAYMENT_ROLE_REQUIRED'});
  const paid=await h.service.recordManual(h.ctx,h.u,c.id,req);
  expect(paid.payment).toMatchObject({state:'MANUAL_RECORDED',recordedBy:h.ctx.userId});
  const doneReq={expectedVersion:4,idempotencyKey:'done'};
  const done=await h.service.complete(h.ctx,h.u,c.id,doneReq);
  expect(done.status).toBe('COMPLETED');expect(await h.service.complete(h.ctx,h.u,c.id,doneReq)).toEqual(done);
  expect((await h.service.inventory(h.ctx,h.u))[0].stock).toMatchObject({onHand:1,reserved:0});
 });
 it('inactive plan, absent inventory grant and integrated mode deny new native operations; existing cancellation remains available',async()=>{
  const h=await retailFixture(),b=await h.service.createCart(h.ctx,h.u,cartInput()),c=await h.service.confirm(h.ctx,h.u,b.id,confirmInput());
  h.store.activePlan=false;
  await expect(h.service.createCart(h.ctx,h.u,cartInput('tenant-a','inactive'))).rejects.toMatchObject({code:'RETAIL_CAPABILITY_OR_PLAN_REQUIRED'});
  expect((await h.service.cancel(h.ctx,h.u,c.id,{expectedVersion:2,idempotencyKey:'cancel',reason:'Encerramento'})).status).toBe('CANCELLED');
  h.store.activePlan=true;h.store.native=false;
  expect(await h.service.catalog(h.ctx,h.u)).not.toBeNull();
  await expect(h.service.createCart(h.ctx,h.u,cartInput('tenant-a','integrated'))).rejects.toMatchObject({code:'RETAIL_CAPABILITY_OR_PLAN_REQUIRED'});
  h.store.native=true;h.store.grants.delete('RETAIL_INVENTORY');
  await expect(h.service.createCart(h.ctx,h.u,cartInput('tenant-a','no-stock-grant'))).rejects.toMatchObject({code:'RETAIL_CAPABILITY_OR_PLAN_REQUIRED'});
 });
 it('catalog/stock version and SKU identity immutable; tenant and unit reads isolated',async()=>{
  const h=await retailFixture(),b=await h.service.createCart(h.ctx,h.u,cartInput());
  await expect(h.service.publish(h.ctx,h.u,{expectedVersion:1,items:products.slice(1)})).rejects.toMatchObject({code:'RETAIL_SKU_IMMUTABLE'});
  await expect(h.service.publish(h.ctx,h.u,{expectedVersion:0,items:products})).rejects.toMatchObject({code:'RETAIL_CATALOG_VERSION_CONFLICT'});
  await expect(h.service.get(actor('tenant-b'),h.u,b.id)).rejects.toMatchObject({code:'RETAIL_ORDER_NOT_FOUND'});
  await expect(h.service.get(h.ctx,'other',b.id)).rejects.toMatchObject({code:'RETAIL_ORDER_NOT_FOUND'});
  await expect(h.service.get(actor('tenant-a','VIEWER'),h.u,b.id)).rejects.toMatchObject({code:'RETAIL_ROLE_REQUIRED'});
 });
 it('optional Pix uses persisted claim, plan entitlement, PSP GET exact amount/reference and no duplicate call',async()=>{
  const h=await retailFixture(),p=payment(),service=new RetailPaymentService(h.service,{forNewPayment:async()=>p.adapter},()=>{});
  const b=await h.service.createCart(h.ctx,h.u,cartInput()),c=await h.service.confirm(h.ctx,h.u,b.id,confirmInput());
  h.store.payments=false;
  const req={expectedVersion:c.version,idempotencyKey:'pix'};
  await expect(service.issue(h.ctx,h.u,b.id,req)).rejects.toMatchObject({code:'RETAIL_CAPABILITY_OR_PLAN_REQUIRED'});expect(p.createPix).not.toHaveBeenCalled();
  h.store.payments=true;
  await Promise.all([service.issue(h.ctx,h.u,b.id,req),service.issue(h.ctx,h.u,b.id,req)]);expect(p.createPix).toHaveBeenCalledTimes(1);
  expect((await h.service.get(h.ctx,h.u,b.id)).payment.state).toBe('PENDING');
  p.paid();const verified=await service.refresh(h.ctx,h.u,b.id,{});
  expect(verified.payment.state).toBe('VERIFIED');
  p.wrong();await expect(service.refresh(h.ctx,h.u,b.id,{})).rejects.toMatchObject({code:'RETAIL_PSP_MISMATCH'});
  expect((await h.service.complete(h.ctx,h.u,b.id,{expectedVersion:verified.version,idempotencyKey:'done'})).status).toBe('COMPLETED');
 });
 it('ambiguous Pix result and late settlement cannot reissue or reactivate cancelled order',async()=>{
  const h=await retailFixture(),p=payment(),service=new RetailPaymentService(h.service,{forNewPayment:async()=>p.adapter},()=>{});
  const b=await h.service.createCart(h.ctx,h.u,cartInput()),c=await h.service.confirm(h.ctx,h.u,b.id,confirmInput());
  p.createPix.mockRejectedValueOnce(Error('timeout'));
  const request={expectedVersion:c.version,idempotencyKey:'pix'};
  const uncertain=await service.issue(h.ctx,h.u,b.id,request);
  expect(uncertain.payment.state).toBe('REVIEW_REQUIRED');
  await service.issue(h.ctx,h.u,b.id,request);expect(p.createPix).toHaveBeenCalledTimes(1);
  const stopped=await h.service.cancel(h.ctx,h.u,b.id,{expectedVersion:uncertain.version,idempotencyKey:'cancel',reason:'Cliente cancelou'});
  expect(stopped.status).toBe('CANCELLED');expect(stopped.payment.state).toBe('REVIEW_REQUIRED');
 });
 it('real HTTP router protects role and tenant; completes manual commerce journey without PSP',async()=>{
  const h=await retailFixture(),p=payment(),paymentService=new RetailPaymentService(h.service,{forNewPayment:async()=>p.adapter},()=>{});
  const app=express();app.use(express.json());app.use('/retail',(req,_r,next)=>{const t=req.header('x-test-tenant');if(t)req.tenantContext=actor(t,req.header('x-test-role')??'OWNER');next();},createRetailRouter(h.service,paymentService));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/retail/units/main';
   const request=async(path:string,body?:unknown,t='tenant-a',role='OWNER')=>{
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(t?{'x-test-tenant':t}:{}),'x-test-role':role,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
    return {status:r.status,json:await r.json()};
   };
   expect((await request('/catalog',undefined,'')).status).toBe(403);
   const cart=await request('/orders',cartInput());expect(cart.status).toBe(201);const path='/orders/'+cart.json.data.id;
   expect((await request(path,undefined,'tenant-b')).status).toBe(404);
   expect((await request(path+'/confirm',confirmInput())).json.data.status).toBe('CONFIRMED');
   const manual={expectedVersion:2,idempotencyKey:'payment',method:'CARD',amountMinor:5000,evidenceRef:'Comprovante 123'};
   expect((await request(path+'/cashier',manual,'tenant-a','ATTENDANT')).status).toBe(403);
   expect((await request(path+'/cashier',manual)).json.data.payment.state).toBe('MANUAL_RECORDED');
   expect((await request(path+'/complete',{expectedVersion:3,idempotencyKey:'complete'})).json.data.status).toBe('COMPLETED');
   expect(p.createPix).not.toHaveBeenCalled();
  }finally{await new Promise<void>((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});}
 },15000);
});
describe('T12 onboarding, plan, grounding and cross-pack reporting',()=>{
 it('all 7 templates, both modes, no business data hardcoded or go-live; strictly validated canonical profile',async()=>{
  const records:OnboardingRecord[]=[];
  const service=new MultiSectorOnboarding({create:async r=>{records.push(r);return r;},get:async()=>null},()=>new Date(BASE));
  const templates=onboardingTemplates();expect(templates).toHaveLength(7);
  for(const t of templates)for(const mode of ['NATIVE_OPERATIONS','INTEGRATED_OPERATIONS']){
   const row=await service.create(actor('tenant-'+t.id),'unit-'+mode,onboardingInput(t.id,mode));
   expect(row.profile.capabilityRegistry.vertical).toBe(t.vertical);
   expect(row.assignment.enabledCapabilities).toEqual([...(mode==='NATIVE_OPERATIONS'?t.native:t.integrated)].sort());
   expect(row.commercialGoLiveAuthorized).toBe(false);
   expect(row.profile.facts[0].answer).toBe('Empresa teste');
   if(mode==='INTEGRATED_OPERATIONS')expect(row.assignment.enabledCapabilities).not.toContain('SCHEDULING');
  }
  expect(records).toHaveLength(14);
  await expect(service.create(actor('tenant-a','STAFF'),'main',onboardingInput())).rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
  await expect(service.create(actor(),'main',{...onboardingInput(),planCode:'PREMIUM'})).rejects.toMatchObject({code:'SCHEDULE_FIELDS_INVALID'});
 });
 it('plan uses active period, scope and valid dates; Basic excludes online Pix',()=>{
  const s=subscription('BASIC');
  expect(planAllows(s,'tenant-a',BASE)).toBe(true);
  expect(planAllows(s,'tenant-a',BASE,'PAYMENTS')).toBe(false);
  expect(planAllows(subscription(),'tenant-a',BASE,'PAYMENTS')).toBe(true);
  expect(activePlan({...s,periodEnd:'invalid'},'tenant-a',BASE)).toBeNull();
  expect(activePlan({...s,periodEnd:new Date(BASE).toISOString()},'tenant-a',BASE)).toBeNull();
  expect(activePlan(s,'foreign',BASE)).toBeNull();
  expect(activePlan({...s,status:'PAST_DUE'},'tenant-a',BASE)).toBeNull();
 });
 it('canonical sector price grounding never reads food catalog prices for retail/services',async()=>{
  const h=await retailFixture(),a=await packFixture('SALON');
  let profile:OnboardingRecord['profile'];
  const service=new MultiSectorOnboarding({create:async r=>{profile=r.profile;return r;},get:async()=>null},()=>new Date(BASE));
  await service.create(h.ctx,h.u,onboardingInput());
  const reader=new BusinessGroundingService({latest:async()=>profile,effective:async()=>profile,createRevision:async()=>{}},
   {} as CatalogRepository,{latest:async()=>null,effective:async()=>null,createRevision:async()=>{}},{retail:(ctx,u)=>h.service.catalog(ctx,u),services:(ctx,u)=>a.service.getConfig(ctx,u)});
  expect((await reader.answer(h.ctx,h.u,'Qual o preço da camisa azul?')).answer).toContain('50,00');
  expect((await reader.evidence(h.ctx,h.u)).evidence.some(e=>e.id.startsWith('retail:'))).toBe(true);
  await service.create(h.ctx,h.u,onboardingInput('salon'));
  expect((await reader.answer(h.ctx,h.u,'Quanto custa Corte e escova?')).answer).toContain('100,00');
  const ev=await reader.evidence(h.ctx,h.u);expect(ev.evidence.some(e=>e.id.startsWith('service:'))).toBe(true);expect(ev.evidence.some(e=>e.id.startsWith('retail:'))).toBe(false);
 });
 it('reports food, retail and services separately and never represents manual receipts or service price as PSP cash',async()=>{
  const h=await retailFixture(),b=await h.service.createCart(h.ctx,h.u,cartInput()),c=await h.service.confirm(h.ctx,h.u,b.id,confirmInput());
  const paid=await h.service.recordManual(h.ctx,h.u,c.id,{expectedVersion:c.version,idempotencyKey:'cash',method:'CASH',amountMinor:c.totalMinor,evidenceRef:'Caixa 01'});
  const done=await h.service.complete(h.ctx,h.u,c.id,{expectedVersion:paid.version,idempotencyKey:'done'});
  const a=await packFixture(),held=await a.service.reserve(a.t,a.u,packInput());
  const report=summarize([{status:'CONFIRMED',totalMinor:3000} as Order],[done],[{...held,status:'COMPLETED'} as Booking]);
  expect(report.food.confirmedOrderValueMinor).toBe(3000);
  expect(report.retail).toMatchObject({completedValueMinor:5000,verifiedCompletedMinor:0,manuallyRecordedCompletedMinor:5000});
  expect(report.services.completedPricedValueMinor).toBe(10000);
 });
 it('UI initializes no invented order or commercial activation',()=>{
  const html=renderToStaticMarkup(createElement(RetailPanel,{tenantId:'a',unitId:'main',role:'OWNER',native:true,inventory:true,checkout:true}));
  expect(html).toContain('Comércio e checkout');expect(html).not.toContain('Confirmar e reservar estoque');
  const onboarding=renderToStaticMarkup(createElement(MultisectorOnboardingPanel,{tenantId:'a',unitId:'main',onSaved:()=>{}}));
  expect(onboarding).toContain('Não altera unidade existente');expect(onboarding).not.toContain('Empresa teste');
 });
});
