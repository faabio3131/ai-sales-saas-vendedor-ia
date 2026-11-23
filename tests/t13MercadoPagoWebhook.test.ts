import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Request,Response} from 'express';

const mock=vi.hoisted(()=>({
 runtime:vi.fn(()=>({})),
 process:vi.fn(async()=>['CONFIRMED'] as string[]),
}));
vi.mock('../src/payments/bankRuntime',()=>({createBankPaymentRuntime:mock.runtime}));
vi.mock('../src/payments/providerWebhooks',()=>({
 PaymentWebhookProcessor:class{process=mock.process;},
}));
import {mercadoPagoWebhookHandler} from '../src/payments/webhook';

function request(query:unknown={'data.id':'123456'},body:unknown={data:{id:'123456'}},raw=true):Request{
 return {query,body,headers:{'x-signature':'signed-in-processor','x-request-id':'req-1'},
  ...(raw?{paymentRawBody:Buffer.from(JSON.stringify(body))}:{})} as unknown as Request;
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
 process.env.MP_PIX_TENANT_ID='tenant-a';
 mock.process.mockResolvedValue(['CONFIRMED']);
});
describe('T13 Mercado Pago public endpoint uses canonical durable processor',()=>{
 it('requires configured legacy tenant binding',async()=>{
  delete process.env.MP_PIX_TENANT_ID;
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get().status).toBe(503);
  expect(mock.runtime).not.toHaveBeenCalled();
 });
 it('rejects missing or mismatched URL ID and missing raw bytes',async()=>{
  for(const req of [request({},{}),request({'data.id':'999'}),request(undefined,undefined,false)]){
   const r=response();await mercadoPagoWebhookHandler(req,r.res);
   expect(r.get().status).toBe(401);
  }
  expect(mock.runtime).not.toHaveBeenCalled();
 });
 it('only forwards to tenant-bound processor with original request bytes',async()=>{
  const r=response();
  await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get()).toEqual({status:200,payload:{ok:true,processed:1}});
  expect(mock.process).toHaveBeenCalledWith(expect.objectContaining({
   provider:'MERCADOPAGO',tenantId:'tenant-a',queryPaymentId:'123456',
   rawBody:expect.any(Buffer),
  }));
 });
 it('returns 503 instead of acknowledging errors from inbox or PSP GET',async()=>{
  mock.process.mockRejectedValueOnce(Error('firestore unavailable'));
  const r=response();await mercadoPagoWebhookHandler(request(),r.res);
  expect(r.get()).toEqual({status:503,payload:{ok:false}});
 });
});
