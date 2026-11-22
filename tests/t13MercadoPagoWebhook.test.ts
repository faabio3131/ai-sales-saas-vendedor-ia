import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Request,Response} from 'express';

// The public production handler is exercised while every external PSP/DB path is
// replaced with a hard test double. No real payments or Firebase writes occur.
const mock=vi.hoisted(()=>({
 settings:vi.fn(()=>({tenantId:'tenant-a'} as {tenantId:string}|null)),
 authorize:vi.fn(async()=>true),
 byProvider:vi.fn(async()=>(null as {id:string}|null)),
 refreshOrder:vi.fn(async()=>undefined),
 legacyRefresh:vi.fn(async()=>undefined),
}));
vi.mock('../src/payments/mercadoPago',()=>({
 mercadoPagoSettingsFromEnv:mock.settings,
 MercadoPagoPixProvider:class {validateWebhook=mock.authorize;},
}));
vi.mock('../src/orderPayments/runtime',()=>({
 createOrderPaymentRuntime:()=>({
  store:{byProvider:mock.byProvider},
  service:{refreshFromWebhook:mock.refreshOrder},
 }),
}));
vi.mock('../src/payments/service',()=>({
 PaymentService:class {handleWebhook=mock.legacyRefresh;},
}));
import {mercadoPagoWebhookHandler} from '../src/payments/webhook';

function request(query:unknown={'data.id':'123456'},body:unknown={data:{id:'123456'}}):Request{
 return {query,body,headers:{'x-signature':'fixture-only'}} as unknown as Request;
}
function response(){
 let status=200,payload:unknown;
 const res={
  status:vi.fn((code:number)=>{status=code;return res;}),
  json:vi.fn((body:unknown)=>{payload=body;return res;}),
 } as unknown as Response;
 return {res,get:()=>({status,payload})};
}
beforeEach(()=>{
 vi.clearAllMocks();
 mock.settings.mockReturnValue({tenantId:'tenant-a'});
 mock.authorize.mockResolvedValue(true);
 mock.byProvider.mockResolvedValue(null);
 mock.refreshOrder.mockResolvedValue(undefined);
 mock.legacyRefresh.mockResolvedValue(undefined);
});
describe('T13 Mercado Pago public webhook production branch matrix',()=>{
 it('fails closed without merchant configuration',async()=>{
  mock.settings.mockReturnValue(null);
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get().status).toBe(503);
  expect(mock.authorize).not.toHaveBeenCalled();
 });
 it('rejects missing provider ID and malformed body',async()=>{
  const r=response();
  await mercadoPagoWebhookHandler(request({},{}),r.res);
  expect(r.get().status).toBe(401);
  expect(mock.authorize).not.toHaveBeenCalled();
 });
 it('rejects mismatched URL and body payment IDs',async()=>{
  const r=response();
  await mercadoPagoWebhookHandler(request({'data.id':'other'}),r.res);
  expect(r.get().status).toBe(401);
  expect(mock.authorize).not.toHaveBeenCalled();
 });
 it('rejects untrusted signature even with consistent IDs',async()=>{
  mock.authorize.mockResolvedValue(false);
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get().status).toBe(401);
  expect(mock.byProvider).not.toHaveBeenCalled();
 });
 it('routes signed new T04 payment to its own PSP verified refresh',async()=>{
  mock.byProvider.mockResolvedValue({id:'order-pay-1'});
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get()).toEqual({status:200,payload:{ok:true}});
  expect(mock.byProvider).toHaveBeenCalledWith('tenant-a','MERCADOPAGO','123456');
  expect(mock.refreshOrder).toHaveBeenCalledWith('tenant-a','MERCADOPAGO','123456');
  expect(mock.legacyRefresh).not.toHaveBeenCalled();
 });
 it('routes signed legacy quote payment to server-side PSP verification',async()=>{
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get()).toEqual({status:200,payload:{ok:true}});
  expect(mock.legacyRefresh).toHaveBeenCalledWith(
   {tenantId:'tenant-a',requestId:'mp-123456'},
   {'x-signature':'fixture-only'}, {data:{id:'123456'}});
  expect(mock.refreshOrder).not.toHaveBeenCalled();
 });
 it('does not acknowledge provider or Firestore reconciliation errors',async()=>{
  mock.byProvider.mockRejectedValueOnce(Error('database unavailable'));
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get()).toEqual({status:503,payload:{ok:false}});
  expect(mock.legacyRefresh).not.toHaveBeenCalled();
 });
 it('does not acknowledge a failure in the legacy fiscal observer',async()=>{
  mock.legacyRefresh.mockRejectedValueOnce(Error('fiscal persistence unavailable'));
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get()).toEqual({status:503,payload:{ok:false}});
 });
});
