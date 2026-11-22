import {generateKeyPairSync,sign} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {authorizePaymentWebhook,parsePaymentWebhook,verifyPagBankEcdsa,PaymentWebhookProcessor}
 from '../src/payments/providerWebhooks';
import type {MerchantCredentialsVault} from '../src/payments/merchantVault';
import type {MerchantProviderConnectionRepository} from '../src/payments/connections';
import type {PaymentRepository} from '../src/payments/contracts';
import type {Payment} from '../src/payments/model';

const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const publicKeyBase64=keys.publicKey.export({format:'der',type:'spki'}).toString('base64');
const payload={id:'ORDE_F87334AC-BB8B-42E2-AA85-8579F70AA328',
 charges:[{id:'CHAR_F1F10115-09F4-4560-85F5-A828D9F96300',status:'PAID'}]};
const raw=Buffer.from(JSON.stringify(payload));
const signature=sign('sha256',raw,keys.privateKey).toString('base64');
const validHeaders={'x-payload-signature':signature};
const conn={tenantId:'merchant-one',providerId:'PAGBANK' as const,status:'ACTIVE' as const,
 recipientId:'beneficiary-one',credentialRef:'mounted:trusted'};
const payment:Payment={id:'order-payment-1',tenantId:'merchant-one',customerId:'c1',
 quoteId:'q1',provider:'PAGBANK',providerPaymentId:payload.id,method:'PIX',
 status:'PENDING',currency:'BRL',amountMinor:2000,
 idempotencyKey:'ordered-1',createdAt:'2026-11-21',updatedAt:'2026-11-21'};
const connections:MerchantProviderConnectionRepository={
 get:async(t,p)=>t===conn.tenantId&&p==='PAGBANK'?conn:null,
 list:async t=>t===conn.tenantId?[conn]:[],
 preferences:async t=>({tenantId:t}),
 setPreference:async(t,p)=>({tenantId:t,preferredProviderId:p}),
};
const vault:MerchantCredentialsVault={load:async()=>({tenantId:conn.tenantId,
 providerId:'PAGBANK',recipientId:conn.recipientId,webhookPublicKeyBase64:publicKeyBase64})};
const payments:PaymentRepository={
 listByTenant:async()=>[],findById:async()=>null,findByIdempotencyKey:async()=>null,
 findByProviderPaymentId:async(t,p,id)=>t===conn.tenantId&&p==='PAGBANK'&&id===payload.id?payment:null,
 create:async p=>p,update:async p=>p,
};
describe('T08.2 — PagBank official signed Order webhook (ECDSA)',()=>{
 it('validates only the exact provider-signed raw bytes, including valid key rotation candidates',()=>{
  expect(verifyPagBankEcdsa(signature,raw,publicKeyBase64)).toBe(true);
  expect(verifyPagBankEcdsa(['invalid.signature',signature],raw,publicKeyBase64)).toBe(true);
  expect(verifyPagBankEcdsa('invalid.signature,'+signature,raw,publicKeyBase64)).toBe(true);
  expect(verifyPagBankEcdsa(signature,Buffer.from(raw.toString()+' '),publicKeyBase64)).toBe(false);
  expect(verifyPagBankEcdsa(undefined,raw,publicKeyBase64)).toBe(false);
  expect(verifyPagBankEcdsa(signature,raw,undefined)).toBe(false);
  const unrelated=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  expect(verifyPagBankEcdsa(signature,raw,unrelated.publicKey.export({type:'spki',format:'der'}).toString('base64'))).toBe(false);
 });
 it('fails closed when only the API bearer token or legacy digest is provided',()=>{
  const legacyHeaders={'x-authenticity-token':'a'.repeat(64)};
  expect(authorizePaymentWebhook({provider:'PAGBANK',tenantId:conn.tenantId,
   headers:legacyHeaders,rawBody:raw,secret:'some-real-access-token'})).toBe(false);
  expect(authorizePaymentWebhook({provider:'PAGBANK',tenantId:conn.tenantId,
   headers:validHeaders,rawBody:raw,secret:'',publicKeyBase64})).toBe(true);
  expect(authorizePaymentWebhook({provider:'PAGBANK',tenantId:conn.tenantId,
   headers:validHeaders,rawBody:Buffer.from('{}'),secret:'',publicKeyBase64})).toBe(false);
 });
 it('accepts only an Order with one named charge and rejects checkout/forged IDs',()=>{
  expect(parsePaymentWebhook('PAGBANK',payload)).toMatchObject({paymentIds:[payload.id]});
  for(const obj of [
   {...payload,id:'CHEC_fake'},
   {...payload,charges:[]},
   {...payload,charges:[{id:'CHAR_aaaaaaaaaa',status:'PAID'},{id:'CHAR_bbbbbbbbbb',status:'PAID'}]},
   {...payload,charges:[{id:'CHAR_aaaaaaaaaa',status:'INVENTED'}]},
  ])expect(()=>parsePaymentWebhook('PAGBANK',obj)).toThrow();
 });
 it('reconciles only tenant-bound provider GET records after ECDSA, never trusts callback PAID',async()=>{
  const refresh=vi.fn(async()=>({...payment,status:'PENDING' as const}));
  const audit={record:vi.fn(async()=>{})};
  const processor=new PaymentWebhookProcessor({connections,vault,payments,service:{refresh},audit});
  const result=await processor.process({provider:'PAGBANK',tenantId:conn.tenantId,
   headers:validHeaders,rawBody:raw,payload});
  expect(result).toEqual(['PENDING']);
  expect(refresh).toHaveBeenCalledWith({tenantId:conn.tenantId,requestId:'bank-webhook'},payment.id);
  expect(audit.record).toHaveBeenCalledOnce();
  await expect(processor.process({provider:'PAGBANK',tenantId:'attacker',
   headers:validHeaders,rawBody:raw,payload})).rejects.toMatchObject({code:'PAYMENT_WEBHOOK_UNAUTHORIZED'});
 });
});
