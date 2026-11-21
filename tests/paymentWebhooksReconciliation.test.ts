import {createHmac} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {authorizePaymentWebhook,parsePaymentWebhook,PaymentWebhookProcessor} from '../src/payments/providerWebhooks';
import type {MerchantProviderConnectionRepository} from '../src/payments/connections';
import type {MerchantCredentialsVault} from '../src/payments/merchantVault';
import type {PaymentRepository} from '../src/payments/contracts';
import type {Payment} from '../src/payments/model';
import {PaymentReconciliationWorker} from '../src/payments/reconciliation';
import {InMemoryVerifiedWebhookLedger} from '../src/payments/webhookLedger';
import type {PaymentReconciliationRepository} from '../src/payments/reconciliation';

const secret='distinct-and-long-test-secret';
const tenant='tenant-a';
const headers=(map:Record<string,string>)=>map;
const raw=Buffer.from(JSON.stringify({id:'evt-1',event:'PAYMENT_RECEIVED',payment:{id:'pay_123'}}));
const asaasHeaders=headers({'asaas-access-token':secret});
const payment:Payment={id:'record-1',tenantId:tenant,customerId:'customer',quoteId:'quote',
 provider:'ASAAS',providerPaymentId:'pay_123',method:'PIX',status:'PENDING',currency:'BRL',
 amountMinor:4500,idempotencyKey:'idem',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
const connection={tenantId:tenant,providerId:'ASAAS' as const,recipientId:'merchant-a',
 credentialRef:'mounted:bound',status:'ACTIVE' as const};
const connections:MerchantProviderConnectionRepository={
 async get(t,p){return t===tenant&&p==='ASAAS'?connection:null;},
 async list(t){return t===tenant?[connection]:[];},
 async preferences(t){return {tenantId:t};},
 async setPreference(t,p){return {tenantId:t,preferredProviderId:p};},
};
const vault:MerchantCredentialsVault={
 async load(conn){return {tenantId:conn.tenantId,providerId:conn.providerId,
  recipientId:conn.recipientId??'',webhookSecret:secret};}
};
const payments:PaymentRepository={
 async listByTenant(t){return t===tenant?[payment]:[];},
 async findById(t,id){return t===tenant&&id===payment.id?payment:null;},
 async findByIdempotencyKey(){return null;},
 async findByProviderPaymentId(t,p,id){return t===tenant&&p==='ASAAS'&&id==='pay_123'?payment:null;},
 async create(p){return p;},async update(p){return p;},
};
describe('Provider-specific payment webhook authentication',()=>{
 it('requires Asaas distinct token and ignores notification status',async()=>{
  expect(authorizePaymentWebhook({provider:'ASAAS',tenantId:tenant,headers:asaasHeaders,
   rawBody:raw,secret})).toBe(true);
  expect(authorizePaymentWebhook({provider:'ASAAS',tenantId:tenant,headers:headers({'asaas-access-token':'wrong'}),
   rawBody:raw,secret})).toBe(false);
  const refresh=vi.fn(async()=>({...payment,status:'CONFIRMED' as const}));
  const audit=new InMemoryVerifiedWebhookLedger();
  const processor=new PaymentWebhookProcessor({connections,vault,payments,service:{refresh},audit});
  const result=await processor.process({provider:'ASAAS',tenantId:tenant,headers:asaasHeaders,
   rawBody:raw,payload:JSON.parse(raw.toString('utf8'))});
  expect(result).toEqual(['CONFIRMED']);
  expect(audit.events.size).toBe(1);
  expect(refresh).toHaveBeenCalledWith({tenantId:tenant,requestId:'bank-webhook'},payment.id);
  await expect(processor.process({provider:'ASAAS',tenantId:'attacker',headers:asaasHeaders,
   rawBody:raw,payload:JSON.parse(raw.toString('utf8'))})).rejects.toMatchObject({code:'PAYMENT_WEBHOOK_UNAUTHORIZED'});
 });
 it('verifies Pagarme HMAC-SHA256 of exact raw bytes (not parsed JSON)',()=>{
  const body=Buffer.from('{"id":"evt-88","data":{"order":{"id":"or_456"}}}');
  const signature=createHmac('sha256',secret).update(body).digest('hex');
  expect(authorizePaymentWebhook({provider:'PAGARME',tenantId:tenant,headers:{'x-hub-signature':'sha256='+signature},
   rawBody:body,secret})).toBe(true);
  expect(authorizePaymentWebhook({provider:'PAGARME',tenantId:tenant,headers:{'x-hub-signature':'sha256='+signature},
   rawBody:Buffer.from('{"different":true}'),secret})).toBe(false);
  expect(parsePaymentWebhook('PAGARME',JSON.parse(body.toString('utf8'))).paymentIds).toEqual(['or_456']);
 });
 it('requires signed mTLS relay envelope and rejects timestamp replay or tenant spoofing',()=>{
  const body=Buffer.from(JSON.stringify({pix:[{txid:'a'.repeat(32)}]}));
  const timestamp=String(Math.floor(Date.now()/1000));
  const message=Buffer.concat([Buffer.from('EFI\\n'+tenant+'\\n'+timestamp+'\\n'),body]);
  const sig=createHmac('sha256',secret).update(message).digest('hex');
  const h={'x-av-relay-timestamp':timestamp,'x-av-relay-signature':sig};
  expect(authorizePaymentWebhook({provider:'EFI',tenantId:tenant,headers:h,rawBody:body,secret})).toBe(true);
  expect(authorizePaymentWebhook({provider:'EFI',tenantId:'other',headers:h,rawBody:body,secret})).toBe(false);
  expect(authorizePaymentWebhook({provider:'EFI',tenantId:tenant,headers:h,rawBody:body,secret,
   now:Date.now()+6*60_000})).toBe(false);
  expect(authorizePaymentWebhook({provider:'EFI',tenantId:tenant,
   headers:{'x-forwarded-client-cert':'verified'},rawBody:body,secret})).toBe(false);
  expect(parsePaymentWebhook('EFI',JSON.parse(body.toString())).paymentIds).toEqual(['a'.repeat(32)]);
 });
 it('refuses malformed and untrusted notification targets',()=>{
  expect(()=>parsePaymentWebhook('ASAAS',{id:'evt',payment:{id:'wrong'}})).toThrow();
  expect(()=>parsePaymentWebhook('PAGARME',{id:'evt',data:{id:'ch_not_order'}})).toThrow();
  expect(()=>parsePaymentWebhook('EFI',{pix:[{txid:'../foreign'}]})).toThrow();
 });
});
class FakeReconciliationStore implements PaymentReconciliationRepository {
 private claimed=new Set<string>();
 completed:string[]=[];
 constructor(private readonly records:Payment[]){}
 async listPending(limit:number){return this.records.slice(0,limit);}
 async claim(id:string){if(this.claimed.has(id))return false;this.claimed.add(id);return true;}
 async finish(id:string,_now:number,succeeded:boolean){this.completed.push(id+':'+succeeded);}
}
describe('Recurring payment reconciliation worker',()=>{
 it('checks only online payments, never marks cash or manual Pix as paid',async()=>{
  const store=new FakeReconciliationStore([payment,
   {...payment,id:'cash',provider:'OFFLINE',providerPaymentId:undefined,method:'CASH_ON_DELIVERY'}]);
  const refresh=vi.fn(async()=>({...payment,status:'CONFIRMED' as const}));
  const worker=new PaymentReconciliationWorker(store,{refresh},()=>1_700_000_000_000);
  expect(await worker.runOnce()).toEqual({scanned:2,claimed:1,confirmed:1,pending:0,failed:0,skipped:1});
  expect(refresh).toHaveBeenCalledTimes(1);
  expect((await worker.runOnce()).claimed).toBe(0);
 });
 it('records failures and never treats an unverifiable amount as confirmed',async()=>{
  const store=new FakeReconciliationStore([payment]);
  const worker=new PaymentReconciliationWorker(store,
   {refresh:async()=>({...payment,status:'CONFIRMED',amountMinor:1})},()=>1_700_000_000_000);
  const result=await worker.runOnce();
  expect(result.failed).toBe(1);
  expect(result.confirmed).toBe(0);
  expect(store.completed).toEqual(['record-1:false']);
 });
});
