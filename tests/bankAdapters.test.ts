import {describe,it,expect,vi} from 'vitest';
import {PixCobBankProvider} from '../src/payments/pixCobBanks';
import {AsaasPixProvider} from '../src/payments/asaas';
import {PagarmePixProvider,pagarmeOrderReference} from '../src/payments/pagarme';
import {PAYMENT_PROVIDER_CATALOG} from '../src/payments/providerCatalog';
import {providerTransport,bankEndpoints} from '../src/payments/bankTransport';
import type {ProviderTransport} from '../src/payments/bankCommon';
const request={tenantId:'pizza',customerId:'customer-1',referenceId:'quote-7',amountMinor:4590,
 currency:'BRL' as const,idempotencyKey:'safe-7'};
const txid='a'.repeat(32);
describe('Five Pix provider adapters',()=>{
 it.each(['EFI','BANCO_INTER','BANCO_DO_BRASIL'] as const)('%s supports deterministic Pix Cob charge and safe polling',async bank=>{
  let assigned='';
  const transport:ProviderTransport=async(path,method,body)=>{
   if(method==='PUT'){assigned=path.split('/').at(-1)??'';
    expect(path).toMatch(/^\/v2\/cob\/[a-f0-9]{32}$/);
    expect(body?.valor).toEqual({original:'45.90'});
    expect(body?.solicitacaoPagador).toBe('pizza:quote-7');
   }
   return {txid:assigned,status:'ATIVA',valor:{original:'45.90'},
    solicitacaoPagador:'pizza:quote-7',pixCopiaECola:'000201010212'};
  };
  const p=new PixCobBankProvider({bank,tenantId:'pizza',recipientId:'receiver',pixKey:'pix-receiver',request:transport});
  const result=await p.createPix(request);
  expect(result).toMatchObject({provider:bank,status:'PENDING',amountMinor:4590,referenceId:'pizza:quote-7'});
  expect(await p.getPaymentStatus(result.providerPaymentId)).toMatchObject({status:'PENDING'});
  await expect(p.createPix({...request,tenantId:'other'})).rejects.toMatchObject({code:'BANK_TENANT_MISMATCH'});
 });
 it('Pix Cob refuses false confirmed status when amount settled differs',async()=>{
  const p=new PixCobBankProvider({bank:'EFI',tenantId:'pizza',recipientId:'receiver',pixKey:'key',
   request:async()=>({txid,status:'CONCLUIDA',valor:{original:'45.90'},solicitacaoPagador:'pizza:quote-7',
    pix:[{valor:'44.90'}]})});
  await expect(p.getPaymentStatus(txid)).rejects.toMatchObject({code:'BANK_SETTLEMENT_MISMATCH'});
 });
 it('Asaas creates charge, obtains actual Pix QR, validates customer mapping',async()=>{
  const api:ProviderTransport=vi.fn(async(path,method,body)=>{
   if(path==='/v3/payments'){expect(method).toBe('POST');expect(body?.customer).toBe('cus_123');
    return {id:'pay_123',status:'PENDING',value:45.90,externalReference:'pizza:quote-7'};}
   if(path==='/v3/payments/pay_123/pixQrCode')return {payload:'000201010212',encodedImage:'cG5n'};
   return {id:'pay_123',status:'RECEIVED',value:45.90,externalReference:'pizza:quote-7'};
  });
  const p=new AsaasPixProvider({tenantId:'pizza',recipientId:'receiver',request:api,
   resolveCustomer:async()=> 'cus_123'});
  const result=await p.createPix(request);
  expect(result).toMatchObject({pixCode:'000201010212',pixQrCodeBase64:'cG5n',status:'PENDING'});
  expect((await p.getPaymentStatus('pay_123')).status).toBe('CONFIRMED');
  await expect(new AsaasPixProvider({tenantId:'pizza',recipientId:'receiver',request:api,
   resolveCustomer:async()=>null}).createPix(request)).rejects.toMatchObject({code:'ASAAS_CUSTOMER_NOT_MAPPED'});
 });
 it('Pagar.me builds a Pix order and verifies its charge',async()=>{
  const raw={id:'or_123',code:pagarmeOrderReference('pizza','quote-7'),status:'pending',
   charges:[{amount:4590,status:'pending',last_transaction:{qr_code:'000201010212'}}]};
  const api:ProviderTransport=async(path,_method,body)=>{
   if(path==='/core/v5/orders'){expect(body?.customer_id).toBe('cus_123');expect(String(body?.code).length).toBeLessThanOrEqual(52);}
   return raw;
  };
  const p=new PagarmePixProvider({tenantId:'pizza',recipientId:'receiver',request:api,
   resolveCustomer:async()=> 'cus_123'});
  const result=await p.createPix(request);
  expect(result).toMatchObject({provider:'PAGARME',status:'PENDING',amountMinor:4590,pixCode:'000201010212'});
  expect((await p.getPaymentStatus('or_123')).status).toBe('PENDING');
 });
 it('rejects unconfigured bank OAuth/mTLS and fixed transport hosts',async()=>{
  expect(bankEndpoints('EFI').api).toMatch(/^https:/);
  const http=vi.fn();
  const transport=providerTransport('EFI',{tenantId:'pizza',providerId:'EFI',recipientId:'receiver'},http);
  await expect(transport('/v2/cob/'+txid,'PUT',{})).rejects.toMatchObject({code:'BANK_MTLS_REQUIRED'});
  expect(http).not.toHaveBeenCalled();
 });
 it('does not list placeholders as implemented',()=>{
  const active=PAYMENT_PROVIDER_CATALOG.filter(x=>x.status==='ADAPTER_IMPLEMENTED').map(x=>x.id);
  expect(active).toEqual(['MERCADOPAGO','EFI','ASAAS','PAGARME','BANCO_INTER','BANCO_DO_BRASIL']);
 });
});
