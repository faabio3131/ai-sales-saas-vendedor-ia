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
import {verifiedWebhookDeliveryId,VerifiedWebhookRecoveryWorker} from '../src/payments/webhookRecovery';
import type {VerifiedWebhookDelivery,VerifiedWebhookKey,VerifiedWebhookRecoveryRepository} from '../src/payments/webhookRecovery';

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
 it('routes authenticated notifications for retail and bookings using PSP GET, never payload state',async()=>{
  const noLegacy:PaymentRepository={...payments,findByProviderPaymentId:async()=>null};
  for(const domain of ['RETAIL','BOOKING_DEPOSIT'] as const){
   const refreshVerified=vi.fn(async()=>({domain,paymentId:'sector-record',status:'VERIFIED' as const}));
   const audit=new InMemoryVerifiedWebhookLedger();
   const processor=new PaymentWebhookProcessor({connections,vault,payments:noLegacy,
    service:{refresh:vi.fn()},multisector:{refreshVerified},audit});
   const result=await processor.process({provider:'ASAAS',tenantId:tenant,headers:asaasHeaders,
    rawBody:raw,payload:JSON.parse(raw.toString('utf8'))});
   expect(result).toEqual(['VERIFIED']);
   expect(refreshVerified).toHaveBeenCalledWith(tenant,'ASAAS','pay_123');
   expect([...audit.events.values()][0]).toMatchObject({domain,paymentId:'sector-record',verifiedStatus:'VERIFIED'});
  }
 });
 it('returns retryable conflict for an unmatched but authenticated PSP notification',async()=>{
  const noLegacy:PaymentRepository={...payments,findByProviderPaymentId:async()=>null};
  const processor=new PaymentWebhookProcessor({connections,vault,payments:noLegacy,
   service:{refresh:vi.fn()},multisector:{refreshVerified:async()=>null}});
  await expect(processor.process({provider:'ASAAS',tenantId:tenant,headers:asaasHeaders,
   rawBody:raw,payload:JSON.parse(raw.toString('utf8'))}))
   .rejects.toMatchObject({code:'PAYMENT_WEBHOOK_REFERENCE_UNMATCHED'});
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
  const message=Buffer.concat([Buffer.from('EFI\n'+tenant+'\n'+timestamp+'\n'),body]);
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
class FakeVerifiedInbox implements VerifiedWebhookRecoveryRepository{
 state?: (id:string)=>Promise<VerifiedWebhookDelivery['state']|null>;
 private nextToken=0;
 readonly rows=new Map<string,VerifiedWebhookDelivery>();
 async enqueue(e:VerifiedWebhookKey,now:number){
  const id=verifiedWebhookDeliveryId(e);
  if(!this.rows.has(id))this.rows.set(id,{...e,id,state:'PENDING',attempts:0,
   leaseUntil:0,nextAttemptAt:now,firstSeenAt:now,updatedAt:now});
 }
 async due(_limit:number,now:number){return [...this.rows.values()].filter(r=>r.state==='PENDING'&&r.nextAttemptAt<=now);}
 async claim(id:string,now:number){
  const row=this.rows.get(id);
  if(!row||row.leaseUntil>now||row.state!=='PENDING'||row.nextAttemptAt>now)return false;
  row.leaseToken='lease-'+(++this.nextToken);
  row.leaseUntil=now+120000;return row.leaseToken;
 }
 async finish(id:string,now:number,success:boolean,reason:string,leaseToken?:string){
  const row=this.rows.get(id)!;
  if(row.state!=='PENDING'||!leaseToken||row.leaseToken!==leaseToken)return;
  row.leaseToken='';
  row.attempts++;
  row.lastErrorCode=reason;
  row.state=success?'COMPLETED':row.attempts>=8?'DLQ':'PENDING';
  row.leaseUntil=0;row.updatedAt=now;row.nextAttemptAt=success?Number.MAX_SAFE_INTEGER:now+30000;
 }
}
describe('T13 durable authenticated webhook inbox and retry',()=>{
 it('recovers unknown PSP references only after a signed notification was saved',async()=>{
  const inbox=new FakeVerifiedInbox(),noLegacy:PaymentRepository={
   ...payments,findByProviderPaymentId:async()=>null,
  };
  let found=false;
  const multisector={refreshVerified:vi.fn(async()=>{
   return found?{domain:'RETAIL' as const,paymentId:'order-1',status:'VERIFIED' as const}:null;
  })};
  const processor=new PaymentWebhookProcessor({connections,vault,payments:noLegacy,
   service:{refresh:vi.fn()},multisector,recovery:inbox});
  const delivery={provider:'ASAAS',tenantId:tenant,headers:asaasHeaders,
   rawBody:raw,payload:JSON.parse(raw.toString('utf8'))};
  await expect(processor.process(delivery))
   .rejects.toMatchObject({code:'PAYMENT_WEBHOOK_REFERENCE_UNMATCHED'});
  expect(inbox.rows.size).toBe(1);
  // A failed signed callback is delayed for retry, never processed immediately in a hot loop.
  [...inbox.rows.values()][0].nextAttemptAt=0;
  const retry=new VerifiedWebhookRecoveryWorker(inbox,event=>processor.reconcileVerified(event),()=>Date.now());
  found=true;
  expect((await retry.runOnce()).reconciled).toBe(1);
  expect([...inbox.rows.values()][0].state).toBe('COMPLETED');
  expect((await retry.runOnce()).scanned).toBe(0);
 });
 it('moves unresolved authenticated payments to human-review DLQ after bounded retries',async()=>{
  const inbox=new FakeVerifiedInbox(),e={tenantId:tenant,provider:'ASAAS',providerPaymentId:'pay_lost',eventId:'evt_1'};
  await inbox.enqueue(e,0);
  const retry=new VerifiedWebhookRecoveryWorker(inbox,async()=>{throw Error('unknown');},()=>0);
  for(let i=0;i<8;i++){const record=[...inbox.rows.values()][0];record.nextAttemptAt=0;await retry.runOnce();}
  expect([...inbox.rows.values()][0].state).toBe('DLQ');
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

describe('T13 independent audit PAG-001: synchronous delivery is leased',()=>{
 it('never concurrently refreshes the same signed event and acknowledges completed redelivery',async()=>{
  const inbox=new FakeVerifiedInbox();
  inbox.state=async id=>inbox.rows.get(id)?.state??null;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const refresh=vi.fn(async()=>{
   await gate;
   return {...payment,status:'CONFIRMED' as const};
  });
  const processor=new PaymentWebhookProcessor({connections,vault,payments,
   service:{refresh},recovery:inbox});
  const input={provider:'ASAAS',tenantId:tenant,headers:asaasHeaders,
   rawBody:raw,payload:JSON.parse(raw.toString('utf8'))};
  const first=processor.process(input);
  const second=processor.process(input);
  // Attach rejection handlers immediately; Vitest treats late catches as unhandled.
  const settled=Promise.allSettled([first,second]);
  await new Promise(resolve=>setTimeout(resolve,15));
  release();
  const results=await settled;
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect([...inbox.rows.values()][0]?.state).toBe('COMPLETED');
  expect(await processor.process(input)).toEqual([]);
  expect(refresh).toHaveBeenCalledTimes(1);
 });
});

describe('T13 independent reauditor fencing regression',()=>{
 it('rejects stale worker completion after a newer claim owns the lease',async()=>{
  const inbox=new FakeVerifiedInbox();
  const entry={tenantId:'tenant-a',provider:'ASAAS',providerPaymentId:'pay_expire',eventId:'evt_expire'};
  await inbox.enqueue(entry,0);
  const id=verifiedWebhookDeliveryId(entry);
  const first=await inbox.claim(id,0);
  expect(typeof first).toBe('string');
  expect(await inbox.claim(id,119999)).toBe(false);
  const second=await inbox.claim(id,120001);
  expect(typeof second).toBe('string');
  expect(second).not.toBe(first);
  await inbox.finish(id,120002,true,'OLD_WORKER',String(first));
  expect(inbox.rows.get(id)?.state).toBe('PENDING');
  await inbox.finish(id,120003,true,'NEW_WORKER',String(second));
  expect(inbox.rows.get(id)?.state).toBe('COMPLETED');
 });
});


describe('T13 signed Mercado Pago multitenant and durable inbox',()=>{
 const mpTenant='tenant-mp',mpSecret='mercado-pago-webhook-secret-0123456789';
 const mpPayload={id:'provider-evt',type:'payment',data:{id:'123456'}};
 function signed(){
  const ts=String(Math.floor(Date.now()/1000));
  const requestId='mp-verified-request-id';
  const signature=createHmac('sha256',mpSecret)
   .update('id:123456;request-id:'+requestId+';ts:'+ts+';').digest('hex');
  return {'x-request-id':requestId,'x-signature':'ts='+ts+',v1='+signature};
 }
 const mpConnections:MerchantProviderConnectionRepository={
  ...connections,
  get:async(t,p)=>t===mpTenant&&p==='MERCADOPAGO'
   ? {tenantId:mpTenant,providerId:'MERCADOPAGO',recipientId:'collector-mp',
      credentialRef:'mounted:tenant-mp',status:'ACTIVE'}:null,
 };
 const mpVault:MerchantCredentialsVault={load:async()=>({
  tenantId:mpTenant,providerId:'MERCADOPAGO',recipientId:'collector-mp',clientSecret:mpSecret,
 })};
 it('durably stores signed callback then verifies multi-sector payment by PSP GET',async()=>{
  const recovery=new FakeVerifiedInbox();
  recovery.state=async id=>recovery.rows.get(id)?.state??null;
  const retail=vi.fn(async()=>({domain:'RETAIL' as const,paymentId:'retail-record',
   status:'VERIFIED' as const}));
  const processor=new PaymentWebhookProcessor({
   connections:mpConnections,vault:mpVault,
   payments:{...payments,findByProviderPaymentId:async()=>null},
   service:{refresh:vi.fn()},multisector:{refreshVerified:retail},recovery,
  });
  const rawBody=Buffer.from(JSON.stringify(mpPayload));
  const req={provider:'MERCADOPAGO',tenantId:mpTenant,headers:signed(),
   rawBody,payload:mpPayload,queryPaymentId:'123456'};
  expect(await processor.process(req)).toEqual(['VERIFIED']);
  expect(recovery.rows.size).toBe(1);
  expect([...recovery.rows.values()][0].state).toBe('COMPLETED');
  expect(await processor.process(req)).toEqual([]);
  expect(retail).toHaveBeenCalledTimes(1);
  expect(retail).toHaveBeenCalledWith(mpTenant,'MERCADOPAGO','123456');
 });
 it('rejects tenant spoofing, altered query id and signature without inbox write',async()=>{
  const recovery=new FakeVerifiedInbox();
  const processor=new PaymentWebhookProcessor({
   connections:mpConnections,vault:mpVault,
   payments:{...payments,findByProviderPaymentId:async()=>null},
   service:{refresh:vi.fn()},recovery,
  });
  const rawBody=Buffer.from(JSON.stringify(mpPayload));
  const req={provider:'MERCADOPAGO',tenantId:mpTenant,headers:signed(),
   rawBody,payload:mpPayload,queryPaymentId:'123456'};
  await expect(processor.process({...req,tenantId:'attacker'}))
   .rejects.toMatchObject({code:'PAYMENT_WEBHOOK_UNAUTHORIZED'});
  await expect(processor.process({...req,queryPaymentId:'999'}))
   .rejects.toMatchObject({code:'PAYMENT_WEBHOOK_UNAUTHORIZED'});
  await expect(processor.process({...req,headers:{...req.headers,'x-signature':'ts=0,v1='+ '0'.repeat(64)}}))
   .rejects.toMatchObject({code:'PAYMENT_WEBHOOK_UNAUTHORIZED'});
  expect(recovery.rows.size).toBe(0);
 });
});
