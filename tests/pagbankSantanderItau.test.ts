import {describe,it,expect,vi} from 'vitest';
import {PagBankPixProvider} from '../src/payments/pagbank';
import {PAYMENT_PROVIDER_CATALOG} from '../src/payments/providerCatalog';
import {providerTransport,bankEndpoints} from '../src/payments/bankTransport';
import type {ProviderTransport} from '../src/payments/bankCommon';

const input={tenantId:'pizza',customerId:'c1',referenceId:'q1',amountMinor:4500,currency:'BRL' as const,idempotencyKey:'idem-123'};
const profile={name:'Cliente Exemplo',email:'cliente@example.com',taxId:'12345678909',phone:{area:'11',number:'987654321'}};
const charge=(referenceId:string, status='WAITING', amount=4500)=>({
 id:'ORDE_12345678-1234-1234-1234-123456789abc',
 reference_id:referenceId,
 charges:[{status,amount:{value:amount,currency:'BRL'},payment_method:{type:'PIX'},
  qr_code:{text:'0002012686abcdef'}}],
});
describe('PagBank Pix Orders adapter',()=>{
 it('creates Pix from verified buyer data and polls the original order',async()=>{
  let orderReference='';
  const request:ProviderTransport=vi.fn(async(path,method,body,headers)=>{
   if(method==='POST'){
    expect(path).toBe('/orders');
    expect(body?.items).toEqual([{reference_id:body?.reference_id,name:'Pedido q1',quantity:1,unit_amount:4500}]);
    const charges=body?.charges as Array<Record<string,unknown>>;
    expect(charges[0].amount).toEqual({value:4500,currency:'BRL'});
    expect((body?.customer as Record<string,unknown>).name).toBe(profile.name);
    expect(headers?.['x-idempotency-key']).toMatch(/^[a-f0-9]{64}$/);
    orderReference=String(body?.reference_id);
    return charge(orderReference);
   }
   expect(path).toMatch(/^\/orders\/ORDE_/);
   return charge(orderReference,'PAID');
  });
  const provider=new PagBankPixProvider({tenantId:'pizza',recipientId:'verified-pagbank-merchant',request,
   resolveCustomer:async()=>profile});
  const created=await provider.createPix(input);
  expect(created).toMatchObject({provider:'PAGBANK',amountMinor:4500,status:'PENDING',pixCode:'0002012686abcdef'});
  expect((await provider.getPaymentStatus(created.providerPaymentId)).status).toBe('CONFIRMED');
  expect(request).toHaveBeenCalledTimes(2);
 });
 it('rejects a missing validated customer, tenant spoofing and mismatched amount',async()=>{
  const p=new PagBankPixProvider({tenantId:'pizza',recipientId:'merchant',request:async()=>charge('any'),
   resolveCustomer:async()=>null});
  await expect(p.createPix(input)).rejects.toMatchObject({code:'PAGBANK_CUSTOMER_DATA_MISSING'});
  await expect(p.createPix({...input,tenantId:'other'})).rejects.toMatchObject({code:'PAGBANK_TENANT_MISMATCH'});
  const p2=new PagBankPixProvider({tenantId:'pizza',recipientId:'merchant',request:async()=>charge('av-incorrect','WAITING',4600),
   resolveCustomer:async()=>profile});
  await expect(p2.createPix(input)).rejects.toMatchObject({code:'PAGBANK_CHARGE_MISMATCH'});
 });
 it('never confirms a wrong payment method, missing order reference or unknown status',async()=>{
  const make=async(data:unknown)=>new PagBankPixProvider({tenantId:'pizza',recipientId:'merchant',
   request:async()=>data as Record<string,unknown>,resolveCustomer:async()=>profile})
   .getPaymentStatus('ORDE_12345678-1234-1234-1234-123456789abc');
  await expect(make({id:'ORDE_12345678-1234-1234-1234-123456789abc',reference_id:'ref',charges:[{
   status:'PAID',amount:{value:4500,currency:'BRL'},payment_method:{type:'CARD'}}]}))
   .rejects.toMatchObject({code:'PAGBANK_METHOD_MISMATCH'});
  await expect(make(charge('ref','UNKNOWN'))).rejects.toMatchObject({code:'PAGBANK_STATUS_INVALID'});
  await expect(make(charge('','PAID'))).rejects.toMatchObject({code:'PAGBANK_REFERENCE_MISSING'});
 });
 it('requires API credentials, fixed HTTPS host and idempotency to send PagBank orders',async()=>{
  expect(bankEndpoints('PAGBANK').api).toBe('https://api.pagseguro.com');
  const http=vi.fn(async()=>({ok:true}));
  const transport=providerTransport('PAGBANK',{tenantId:'pizza',providerId:'PAGBANK',
   recipientId:'merchant',apiKey:'test-token'},http);
  await expect(transport('/orders','POST',{})).rejects.toMatchObject({code:'PAGBANK_IDEMPOTENCY_REQUIRED'});
  await transport('/orders','POST',{amount:4500},{'x-idempotency-key':'test-key'});
  expect(http.mock.calls.length).toBe(1);
  expect(http.mock.calls[0][0]).toBe('https://api.pagseguro.com/orders');
  expect(http.mock.calls[0][3]).toEqual({Authorization:'Bearer test-token','x-idempotency-key':'test-key'});
 });
 it('includes Santander and Itau in catalog but blocks unverified bank contracts',()=>{
  const p=PAYMENT_PROVIDER_CATALOG.find(p=>p.id==='PAGBANK');
  expect(p?.status).toBe('ADAPTER_IMPLEMENTED');
  expect(PAYMENT_PROVIDER_CATALOG.find(p=>p.id==='SANTANDER')?.status).toBe('CONTRACT_PENDING');
  expect(PAYMENT_PROVIDER_CATALOG.find(p=>p.id==='ITAU')?.status).toBe('CONTRACT_PENDING');
 });
});
