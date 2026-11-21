import { describe,expect,it,vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Order,OrderRepository } from '../src/orders/model';
import type { TenantContext } from '../src/types/contracts';
import type { PaymentProviderInterface,PaymentRepository } from '../src/payments/contracts';
import type { ProviderPaymentRequest,ProviderPaymentResult } from '../src/payments/model';
import type { OrderPayment,OrderPaymentRepository,OrderPaymentStatus,
  OrderPaymentProviderResolver,OrderPaymentEventKind,OutboxRecord,OutboxRepository } from '../src/orderPayments/model';
import { OrderPaymentService } from '../src/orderPayments/service';
import { createOrderPaymentsRouter } from '../src/orderPayments/routes';
import { OrderPaymentOutboxWorker } from '../src/orderPayments/outbox';
import { OrderPaymentReconciliationWorker,type OrderPaymentReconciliationRepository } from '../src/orderPayments/reconciliation';
import { InMemoryPaymentMethodsRepository,PaymentMethodsService } from '../src/payments/methods';
import { PaymentWebhookProcessor,authorizePaymentWebhook } from '../src/payments/providerWebhooks';
import { InMemoryVerifiedWebhookLedger } from '../src/payments/webhookLedger';
import { errorHandler } from '../src/api/middleware/errorHandler';

const NOW='2026-11-21T16:00:00.000Z';
const tenant=(id='pizza-a',role='OWNER'):TenantContext=>({tenantId:id,userId:'operator-'+id,role,requestId:'req'});
function baseOrder():Order{
 return {
  id:'order_confirmed001',tenantId:'pizza-a',unitId:'main',orderNumber:1,version:2,
  customerId:'cust-a',status:'CONFIRMED',currency:'BRL',
  catalogVersion:1,businessProfileVersion:1,operationMode:'NATIVE_OPERATIONS',
  lines:[{catalogItemId:'drink',kind:'ITEM',name:'Bebida',quantity:1,
    unitPriceMinor:5500,totalMinor:5500}],
  fulfillment:{kind:'PICKUP'},subtotalMinor:5500,discountMinor:0,deliveryFeeMinor:0,
  totalMinor:5500,paymentState:'NOT_REQUESTED',productionState:'NOT_DISPATCHED',
  deliveryState:'NOT_STARTED',createdBy:'operator-pizza-a',createdAt:NOW,updatedAt:NOW,
  customerConfirmation:{kind:'CUSTOMER_MESSAGE',evidenceRef:'conversation:conv:msg',
    totalMinor:5500,at:NOW,verifiedBy:'operator-pizza-a'},
 };
}
class PSP {
 readonly id='ASAAS';readonly tenantId='pizza-a';readonly recipientId='merchant-receiver';
 readonly supportedMethods=['PIX','PAYMENT_LINK','CHECKOUT'] as const;
 readonly statuses=new Map<string,ProviderPaymentResult['status']| 'REFUNDED'>();
 calls={pix:0,link:0,checkout:0,read:0,refund:0};
 invalidReference=false;invalidAmount=false;throwCreate=false;allowCheckout=true;allowRefund=true;
 private response(input:ProviderPaymentRequest){
  const status=this.statuses.get('pay_123')??'PENDING';
  return {
   provider:this.id,providerPaymentId:'pay_123',status,
   amountMinor:input.amountMinor+(this.invalidAmount?100:0),
   referenceId:this.invalidReference?'other:wrong':input.tenantId+':'+input.referenceId,
   pixCode:'00020126580014BR.GOV.BCB.PIX...',pixQrCodeBase64:'TESTQR',
   paymentUrl:'https://checkout.example.test/abc',expiresAt:'2026-11-22T16:00:00.000Z',
  } as ProviderPaymentResult;
 }
 private last?:ProviderPaymentRequest;
 async createPix(input:ProviderPaymentRequest):Promise<ProviderPaymentResult>{
  this.calls.pix++;this.last=input;
  if(this.throwCreate)throw new Error('provider timeout');
  this.statuses.set('pay_123','PENDING');
  return this.response(input);
 }
 async createPaymentLink(input:ProviderPaymentRequest){this.calls.link++;this.last=input;return this.response(input);}
 async createCheckout(input:ProviderPaymentRequest){
  this.calls.checkout++;this.last=input;
  if(!this.allowCheckout)throw new Error('checkout unsupported');
  return this.response(input);
 }
 async getPaymentStatus(_id:string):Promise<ProviderPaymentResult>{
  this.calls.read++;
  if(!this.last)throw new Error('No transaction');
  return this.response(this.last);
 }
 async refundPayment(_id:string):Promise<ProviderPaymentResult>{
  this.calls.refund++;
  if(!this.allowRefund)throw new Error('unsupported refund');
  this.statuses.set('pay_123','REFUNDED');
  return this.getPaymentStatus('pay_123');
 }
 async cancelPayment(_id:string):Promise<ProviderPaymentResult>{throw new Error('not supported');}
 async validateWebhook(){return false;}
 async normalizeWebhook(){throw new Error('not supported');}
}
class MemoryOrders {
 readonly state=new Map<string,Order>();
 constructor(initial:Order=baseOrder()){this.state.set(initial.id,structuredClone(initial));}
 async findById(t:string,u:string,id:string):Promise<Order|null>{
  const value=this.state.get(id);
  return value?.tenantId===t&&value.unitId===u?structuredClone(value):null;
 }
}
class MemoryPayments implements OrderPaymentRepository {
 readonly records=new Map<string,OrderPayment>();
 readonly outbox:OutboxRecord[]=[];
 private readonly ids=new Map<string,{id:string;fingerprint:string}>();
 private readonly byOrders=new Map<string,string>();
 private tail:Promise<void>=Promise.resolve();
 constructor(private readonly orders:MemoryOrders){}
 private key(...args:string[]){return JSON.stringify(args);}
 private async atomic<T>(call:()=>Promise<T>|T):Promise<T>{
  let resolve!:()=>void;
  const mine=new Promise<void>(r=>{resolve=r;});
  const prev=this.tail;this.tail=prev.then(()=>mine);
  await prev;
  try{return await call();}finally{resolve();}
 }
 async get(t:string,u:string,id:string){
  const v=this.records.get(id);
  return v?.tenantId===t&&v.unitId===u?structuredClone(v):null;
 }
 async byOrder(t:string,u:string,oid:string){
  const id=this.byOrders.get(this.key(t,u,oid));
  return id?this.get(t,u,id):null;
 }
 async byIdempotency(t:string,u:string,key:string){
  const id=this.ids.get(this.key(t,u,key));
  return id?this.get(t,u,id.id):null;
 }
 async byProvider(t:string,provider:string,id:string){
  const matches=[...this.records.values()].filter(p=>p.tenantId===t&&
    p.provider===provider&&p.providerPaymentId===id);
  return matches.length===1?structuredClone(matches[0]):null;
 }
 private emit(p:OrderPayment,kind:OrderPaymentEventKind){
  this.outbox.push({id:p.id+':'+p.version,tenantId:p.tenantId,unitId:p.unitId,
    paymentId:p.id,orderId:p.orderId,paymentVersion:p.version,
    kind,status:p.status,amountMinor:p.amountMinor,method:p.method,
    provider:p.provider,occurredAt:p.updatedAt,
    deliveryStatus:'PENDING',attemptCount:0,nextAttemptAt:0,leaseUntil:0,updatedAt:p.updatedAt,
    ...(p.verificationSource?{verificationSource:p.verificationSource}:{}),
    ...(p.verifiedBy?{verifiedBy:p.verifiedBy}:{}),
    ...(p.receiptRef?{receiptRef:p.receiptRef}:{})});
 }
 async reserve(p:OrderPayment){
  return this.atomic(async()=>{
   const key=this.key(p.tenantId,p.unitId,p.idempotencyKey);
   const prior=this.ids.get(key);
   if(prior){
    if(prior.fingerprint!==p.fingerprint)
      throw Object.assign(new Error('conflict'),{code:'ORDER_PAYMENT_IDEMPOTENCY_CONFLICT'});
    return {payment:structuredClone(this.records.get(prior.id)!),created:false};
   }
   const order=this.orders.state.get(p.orderId);
   if(!order||order.tenantId!==p.tenantId||order.unitId!==p.unitId||
     order.status!=='CONFIRMED'||order.paymentState!=='NOT_REQUESTED'||
     order.totalMinor!==p.amountMinor||!order.customerConfirmation||
     this.byOrders.has(this.key(p.tenantId,p.unitId,p.orderId)))
     throw Object.assign(new Error('conflict'),{code:'ORDER_PAYMENT_NOT_CONFIRMABLE'});
   order.paymentState='PENDING';order.version++;
   this.ids.set(key,{id:p.id,fingerprint:p.fingerprint});
   this.byOrders.set(this.key(p.tenantId,p.unitId,p.orderId),p.id);
   this.records.set(p.id,structuredClone(p));this.emit(p,'PAYMENT_INTENT_RESERVED');
   return {payment:structuredClone(p),created:true};
  });
 }
 async transition(p:OrderPayment,expected:number,event:OrderPaymentEventKind){
  return this.atomic(()=>{
   const prior=this.records.get(p.id);
   if(!prior||prior.version!==expected||p.version!==expected+1||
     prior.tenantId!==p.tenantId||prior.unitId!==p.unitId||
     prior.amountMinor!==p.amountMinor||prior.orderId!==p.orderId||
     prior.provider!==p.provider)
     throw Object.assign(new Error('version conflict'),{code:'ORDER_PAYMENT_VERSION_CONFLICT'});
   const order=this.orders.state.get(p.orderId)!;
   const states:Record<OrderPaymentStatus,Order['paymentState']>={
    CREATION_RESERVED:'PENDING',PENDING:'PENDING',RECONCILIATION_REQUIRED:'PENDING',
    CONFIRMED:'CONFIRMED',FAILED:'FAILED',CANCELLED:'FAILED',EXPIRED:'EXPIRED',
    REFUND_PENDING:'REFUND_PENDING',REFUNDED:'REFUNDED',
   };
   this.records.set(p.id,structuredClone(p));order.version++;order.paymentState=states[p.status];
   this.emit(p,event);return structuredClone(p);
  });
 }
}
async function fixture(initial=baseOrder()){
 const orders=new MemoryOrders(initial),store=new MemoryPayments(orders),psp=new PSP();
 const resolver:OrderPaymentProviderResolver={
  forNewPayment:async(t,pid)=>{if(t!=='pizza-a'||(pid&&pid!=='ASAAS'))
    throw new Error('Merchant connection invalid');return psp as unknown as PaymentProviderInterface;},
  forRecordedPayment:async(p)=>{if(p.tenantId!=='pizza-a'||p.provider!=='ASAAS')
    throw new Error('Recipient account mismatch');return psp as unknown as PaymentProviderInterface;},
 };
 const methods=new PaymentMethodsService(new InMemoryPaymentMethodsRepository());
 await methods.update(tenant(),{pixManualEnabled:true,cardOnDeliveryEnabled:true,
   cashOnDeliveryEnabled:true,pixKey:'validated-pix-key@bank'});
 const service=new OrderPaymentService(store,orders as unknown as OrderRepository,resolver,
   methods,undefined,()=>new Date(NOW));
 return {orders,store,psp,resolver,methods,service};
}
const online=(key='online-pix-001')=>({idempotencyKey:key,method:'PIX' as const,providerId:'ASAAS'});
describe('T04 — Confirmed order to bank payment, separate state machines',()=>{
 it('requires a customer-confirmed order and never charges a draft/forged confirmation',async()=>{
  const draft=baseOrder();draft.status='DRAFT';
  const e=await fixture(draft);
  await expect(e.service.create(tenant(),'main',draft.id,online())).rejects.toMatchObject({
   code:'ORDER_PAYMENT_REQUIRES_CONFIRMED_ORDER',
  });
  expect(e.psp.calls.pix).toBe(0);
  const forged=baseOrder();delete forged.customerConfirmation;
  const f=await fixture(forged);
  await expect(f.service.create(tenant(),'main',forged.id,online())).rejects.toMatchObject({
   code:'ORDER_PAYMENT_REQUIRES_CONFIRMED_ORDER',
  });
  expect(f.psp.calls.pix).toBe(0);
 });
 it('creates a real-shaped Pix intent with idempotency, expiry and no false settled status',async()=>{
  const e=await fixture();
  const p=await e.service.create(tenant(),'main','order_confirmed001',online());
  expect(p).toMatchObject({
   tenantId:'pizza-a',unitId:'main',orderId:'order_confirmed001',
   status:'PENDING',method:'PIX',provider:'ASAAS',
   amountMinor:5500,currency:'BRL',providerPaymentId:'pay_123',
   pixCode:'00020126580014BR.GOV.BCB.PIX...',
   expiresAt:'2026-11-22T16:00:00.000Z',
  });
  expect(e.orders.state.get(p.orderId)).toMatchObject({
   status:'CONFIRMED',paymentState:'PENDING',productionState:'NOT_DISPATCHED',
   deliveryState:'NOT_STARTED',
  });
  expect(e.store.outbox.map(x=>x.kind))
   .toEqual(['PAYMENT_INTENT_RESERVED','PAYMENT_AWAITING_VERIFICATION']);
  expect(e.psp.calls.pix).toBe(1);
  const repeat=await e.service.create(tenant(),'main',p.orderId,online());
  expect(repeat.id).toBe(p.id);expect(e.psp.calls.pix).toBe(1);
  await expect(e.service.create(tenant(),'main',p.orderId,
    {idempotencyKey:'online-pix-001',method:'CHECKOUT',providerId:'ASAAS'}))
    .rejects.toMatchObject({code:'ORDER_PAYMENT_IDEMPOTENCY_CONFLICT'});
 });
 it('preflights customer data before reservation and preserves the ability to fix it',async()=>{
  const e=await fixture();
  const provider=e.psp as PSP & {preflightPix?:(input:ProviderPaymentRequest)=>Promise<void>};
  provider.preflightPix=async(input)=>{
   if(!input.payerEmail)throw new Error('Email required for configured PSP');
  };
  await expect(e.service.create(tenant(),'main','order_confirmed001',online()))
    .rejects.toThrow('Email required');
  expect(e.store.records.size).toBe(0);
  expect(e.orders.state.get('order_confirmed001')?.paymentState).toBe('NOT_REQUESTED');
  expect(e.psp.calls.pix).toBe(0);
  const fixed=await e.service.create(tenant(),'main','order_confirmed001',{
   ...online(),payerEmail:'payer@example.test',
  });
  expect(fixed.status).toBe('PENDING');expect(e.psp.calls.pix).toBe(1);
 });
 it('deduplicates simultaneous client retries without issuing a second Pix',async()=>{
  const e=await fixture();
  const [first,second,third]=await Promise.all([
   e.service.create(tenant(),'main','order_confirmed001',online('same-request001')),
   e.service.create(tenant(),'main','order_confirmed001',online('same-request001')),
   e.service.create(tenant(),'main','order_confirmed001',online('same-request001')),
  ]);
  expect(new Set([first.id,second.id,third.id]).size).toBe(1);
  expect(e.psp.calls.pix).toBe(1);
  expect(e.store.records.size).toBe(1);
 });
 it('treats provider timeout as uncertain and refuses a second external create',async()=>{
  const e=await fixture();e.psp.throwCreate=true;
  await expect(e.service.create(tenant(),'main','order_confirmed001',online()))
    .rejects.toMatchObject({code:'ORDER_PAYMENT_CREATION_UNCERTAIN'});
  const uncertain=(await e.store.byOrder('pizza-a','main','order_confirmed001'))!;
  expect(uncertain.status).toBe('RECONCILIATION_REQUIRED');
  expect(uncertain.providerPaymentId).toBeUndefined();
  expect((await e.service.create(tenant(),'main','order_confirmed001',online())).id)
    .toBe(uncertain.id);
  expect(e.psp.calls.pix).toBe(1);
 });
 it('rejects PSP amount or reference mismatches and never credits the order',async()=>{
  const e=await fixture();e.psp.invalidReference=true;
  await expect(e.service.create(tenant(),'main','order_confirmed001',online()))
    .rejects.toMatchObject({code:'ORDER_PAYMENT_CREATION_UNCERTAIN'});
  expect(e.orders.state.get('order_confirmed001')?.paymentState).toBe('PENDING');
  expect((await e.store.byOrder('pizza-a','main','order_confirmed001'))?.status)
    .toBe('RECONCILIATION_REQUIRED');
  const f=await fixture();f.psp.invalidAmount=true;
  await expect(f.service.create(tenant(),'main','order_confirmed001',online()))
    .rejects.toMatchObject({code:'ORDER_PAYMENT_CREATION_UNCERTAIN'});
  expect(f.orders.state.get('order_confirmed001')?.paymentState).toBe('PENDING');
 });
 it('recovers a missing PSP reference by owner-only verified GET without double issuing Pix',async()=>{
  const e=await fixture();e.psp.throwCreate=true;
  await expect(e.service.create(tenant(),'main','order_confirmed001',online()))
    .rejects.toMatchObject({code:'ORDER_PAYMENT_CREATION_UNCERTAIN'});
  const uncertain=(await e.store.byOrder('pizza-a','main','order_confirmed001'))!;
  await expect(e.service.recoverUnknown(tenant('pizza-a','CASHIER'),'main',uncertain.orderId,{
   expectedVersion:uncertain.version,providerPaymentId:'pay_123',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_OWNER_REQUIRED'});
  await expect(e.service.recoverUnknown(tenant(),'main',uncertain.orderId,{
   expectedVersion:uncertain.version,providerPaymentId:'pay_FAKE',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_RECOVERY_PSP_MISMATCH'});
  const recovered=await e.service.recoverUnknown(tenant(),'main',uncertain.orderId,{
   expectedVersion:uncertain.version,providerPaymentId:'pay_123',
  });
  expect(recovered).toMatchObject({status:'PENDING',providerPaymentId:'pay_123'});
  expect(e.psp.calls.pix).toBe(1);
  e.psp.statuses.set('pay_123','CONFIRMED');
  expect((await e.service.refresh(tenant(),'main',recovered.id)).status).toBe('CONFIRMED');
 });
 it('refuses online methods without a declared PSP checkout capability BEFORE reservation',async()=>{
  const e=await fixture();
  const limited={...e.psp,supportedMethods:undefined};
  const resolver:OrderPaymentProviderResolver={
   forNewPayment:async()=>limited as unknown as PaymentProviderInterface,
   forRecordedPayment:async()=>limited as unknown as PaymentProviderInterface,
  };
  const s=new OrderPaymentService(e.store,e.orders as unknown as OrderRepository,
   resolver,e.methods);
  await expect(s.create(tenant(),'main','order_confirmed001',{
   method:'CHECKOUT',idempotencyKey:'no-checkout-001',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_ONLINE_METHOD_UNSUPPORTED'});
  expect(e.store.records.size).toBe(0);
  expect(e.orders.state.get('order_confirmed001')?.paymentState).toBe('NOT_REQUESTED');
 });
 it('handles expiry, late bank confirmation, webhook retries and stale PENDING without downgrading',async()=>{
  const e=await fixture();
  const p=await e.service.create(tenant(),'main','order_confirmed001',online());
  e.psp.statuses.set('pay_123','EXPIRED');
  expect((await e.service.refresh(tenant(),'main',p.id)).status).toBe('EXPIRED');
  e.psp.statuses.set('pay_123','CONFIRMED');
  const settled=await e.service.refresh(tenant(),'main',p.id);
  expect(settled).toMatchObject({status:'CONFIRMED',verificationSource:'PSP_GET'});
  expect(e.orders.state.get(p.orderId)?.paymentState).toBe('CONFIRMED');
  expect(e.orders.state.get(p.orderId)?.productionState).toBe('NOT_DISPATCHED');
  const count=e.store.outbox.length;
  expect((await e.service.refresh(tenant(),'main',p.id)).status).toBe('CONFIRMED');
  e.psp.statuses.set('pay_123','PENDING');
  expect((await e.service.refresh(tenant(),'main',p.id)).status).toBe('CONFIRMED');
  expect(e.store.outbox).toHaveLength(count);
 });
 it('supports checkout URL without PAN and refuses customer-supplied card details',async()=>{
  const e=await fixture();
  const c=await e.service.create(tenant(),'main','order_confirmed001',{
   method:'CHECKOUT',idempotencyKey:'checkout-abc001',payerEmail:'client@example.test',
  });
  expect(c.paymentUrl).toContain('https://checkout.');
  expect(c).not.toHaveProperty('payerEmail');
  expect(e.psp.calls.checkout).toBe(1);
  const f=await fixture();
  await expect(f.service.create(tenant(),'main','order_confirmed001',{
   method:'CHECKOUT',idempotencyKey:'checkout-abc001',
   cardNumber:'4111111111111111',
  } as never)).rejects.toMatchObject({code:'ORDER_PAYMENT_FIELDS_INVALID'});
  expect(f.psp.calls.checkout).toBe(0);
 });
 it('keeps online PSP verification separate from offline operator collection',async()=>{
  const e=await fixture();
  const p=await e.service.create(tenant(),'main','order_confirmed001',{
   method:'CASH_ON_DELIVERY',idempotencyKey:'cash-collect-001',
   cashTenderedMinor:10000,
  });
  expect(p).toMatchObject({status:'PENDING',provider:'OFFLINE',
   cashTenderedMinor:10000,changeMinor:4500});
  expect(e.psp.calls.pix).toBe(0);
  await expect(e.service.collect(tenant('pizza-a','ATTENDANT'),'main',p.orderId,{
   expectedVersion:2,amountMinor:5500,receiptRef:'cash-receipt-001',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_COLLECTION_ROLE_DENIED'});
  await expect(e.service.collect(tenant(),'main',p.orderId,{
   expectedVersion:2,amountMinor:1,receiptRef:'cash-receipt-001',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_COLLECTION_AMOUNT_MISMATCH'});
  await expect(e.service.collect(tenant('pizza-a','CASHIER'),'main',p.orderId,{
   expectedVersion:2,amountMinor:5500,receiptRef:'cash-receipt-001',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_CASH_RECEIVED_REQUIRED'});
  const collected=await e.service.collect(tenant('pizza-a','CASHIER'),'main',p.orderId,{
   expectedVersion:2,amountMinor:5500,receiptRef:'cash-receipt-001',receivedMinor:10000,
  });
  expect(collected).toMatchObject({status:'CONFIRMED',verificationSource:'OPERATOR_COD',
   verifiedBy:'operator-pizza-a',receiptRef:'cash-receipt-001',
   cashTenderedMinor:10000,changeMinor:4500});
  expect(e.orders.state.get(p.orderId)?.paymentState).toBe('CONFIRMED');
  expect(e.orders.state.get(p.orderId)?.deliveryState).toBe('NOT_STARTED');
 });
 it('blocks user print as proof of manual Pix and keeps it pending',async()=>{
  const e=await fixture();
  const p=await e.service.create(tenant(),'main','order_confirmed001',{
   method:'PIX_MANUAL',idempotencyKey:'manual-pix-001',
  });
  expect(p.status).toBe('PENDING');
  expect(p.providerPaymentId).toBeUndefined();
  await expect(e.service.collect(tenant(),'main',p.orderId,{
   expectedVersion:2,amountMinor:5500,receiptRef:'screenshot-customer-123',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_COLLECTION_NOT_ALLOWED'});
  expect(e.orders.state.get(p.orderId)?.paymentState).toBe('PENDING');
 });
 it('requires OWNER/ADMIN to request refunds, and never claims refund without provider GET',async()=>{
  const e=await fixture();
  const p=await e.service.create(tenant(),'main','order_confirmed001',online());
  e.psp.statuses.set('pay_123','CONFIRMED');
  const paid=await e.service.refresh(tenant(),'main',p.id);
  await expect(e.service.refund(tenant('pizza-a','CASHIER'),'main',p.orderId,{
   expectedVersion:paid.version,reason:'Customer requested refund',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_OWNER_REQUIRED'});
  e.psp.allowRefund=false;
  const pending=await e.service.refund(tenant(),'main',p.orderId,{
   expectedVersion:paid.version,reason:'Customer requested refund',
  });
  expect(pending.status).toBe('REFUND_PENDING');
  expect(e.orders.state.get(p.orderId)?.paymentState).toBe('REFUND_PENDING');
  await expect(e.service.refund(tenant(),'main',p.orderId,{
   expectedVersion:pending.version,reason:'Try again',
  })).rejects.toMatchObject({code:'ORDER_PAYMENT_REFUND_NOT_ALLOWED'});
  e.psp.statuses.set('pay_123','REFUNDED');
  const verified=await e.service.refresh(tenant(),'main',p.id);
  expect(verified).toMatchObject({status:'REFUNDED',verificationSource:'PSP_GET'});
  expect(e.orders.state.get(p.orderId)?.paymentState).toBe('REFUNDED');
 });
 it('forbids cross-tenant/unit operations, missing principal and unauthorized refund',async()=>{
  const e=await fixture();
  const p=await e.service.create(tenant(),'main','order_confirmed001',online());
  await expect(e.service.get(tenant('pizza-b'),'main',p.orderId))
    .rejects.toMatchObject({code:'ORDER_PAYMENT_ORDER_NOT_FOUND'});
  await expect(e.service.refresh(tenant(),'other-unit',p.id))
    .rejects.toMatchObject({code:'ORDER_PAYMENT_NOT_FOUND'});
  await expect(e.service.create(tenant('pizza-a','VIEWER'),'main',p.orderId,
   online('new-request001'))).rejects.toMatchObject({code:'ORDER_PAYMENT_OPERATOR_DENIED'});
 });
});
describe('T04 — Outbox, reconciliation and authenticated webhook',()=>{
 it('publishes outbox events idempotently and retries failing sink without silent success',async()=>{
  const e=await fixture();
  await e.service.create(tenant(),'main','order_confirmed001',online());
  const events=e.store.outbox.map(x=>({...x,claimToken:'lease-1'}));
  let attempt=0;
  const outbox:OutboxRepository={
   claim:vi.fn(async()=>events),
   delivered:vi.fn(async()=>{}),
   retry:vi.fn(async()=>{}),
  };
  const worker=new OrderPaymentOutboxWorker(outbox,{publish:async()=>{
   attempt++;if(attempt===1)throw new Error('downstream unavailable');
  }},()=>Date.parse(NOW));
  const report=await worker.runOnce(20);
  expect(report).toEqual({claimed:2,published:1,failed:1});
  expect(outbox.retry).toHaveBeenCalledWith(events[0].id,'lease-1',
   Date.parse(NOW),'DELIVERY_FAILED',8);
  expect(outbox.delivered).toHaveBeenCalledTimes(1);
 });
 it('creates investigation when PSP creation reference is unknown and never reissues Pix',async()=>{
  const e=await fixture();e.psp.throwCreate=true;
  await expect(e.service.create(tenant(),'main','order_confirmed001',online())).rejects.toThrow();
  const candidate=(await e.store.byOrder('pizza-a','main','order_confirmed001'))!;
  const repo:OrderPaymentReconciliationRepository={
   candidates:vi.fn(async()=>[candidate]),
   claim:vi.fn(async()=>true),
   finish:vi.fn(async()=>{}),
   investigation:vi.fn(async()=>{}),
  };
  const worker=new OrderPaymentReconciliationWorker(repo,e.service,()=>Date.parse(NOW));
  const result=await worker.runOnce();
  expect(result).toMatchObject({scanned:1,manualReview:1,refreshed:0});
  expect(repo.investigation).toHaveBeenCalledWith(candidate,'PROVIDER_PAYMENT_REFERENCE_UNKNOWN');
  expect(e.psp.calls.pix).toBe(1);
 });
 it('validates signed Asaas callback and then re-fetches PSP status for new order payment',async()=>{
  const e=await fixture();
  const p=await e.service.create(tenant(),'main','order_confirmed001',online());
  e.psp.statuses.set('pay_123','CONFIRMED');
  const secret='a'.repeat(32),raw=Buffer.from(JSON.stringify({
   id:'evt_123',event:'PAYMENT_RECEIVED',payment:{id:'pay_123',status:'FAILED'},
  }));
  const conn={tenantId:'pizza-a',providerId:'ASAAS' as const,
   recipientId:'merchant-receiver',status:'ACTIVE' as const,credentialRef:'test-secret'};
  const audit=new InMemoryVerifiedWebhookLedger();
  const processor=new PaymentWebhookProcessor({
   connections:{get:async()=>conn,list:async()=>[conn],
     preferences:async()=>({tenantId:'pizza-a'}),setPreference:async()=>({tenantId:'pizza-a'})} as never,
   vault:{load:async()=>({tenantId:'pizza-a',providerId:'ASAAS',recipientId:'merchant-receiver',
     webhookSecret:secret})},
   payments:{findByProviderPaymentId:async()=>null} as unknown as PaymentRepository,
   service:{refresh:async()=>{throw new Error('Legacy should not be used');}},
   orderPayments:e.store,orderService:e.service,audit,
  });
  const body=JSON.parse(raw.toString());
  expect(authorizePaymentWebhook({provider:'ASAAS',tenantId:'pizza-a',headers:{
   'asaas-access-token':'wrong'},rawBody:raw,secret})).toBe(false);
  await expect(processor.process({provider:'ASAAS',tenantId:'pizza-a',
   headers:{'asaas-access-token':'wrong'},payload:body,rawBody:raw}))
   .rejects.toMatchObject({code:'PAYMENT_WEBHOOK_UNAUTHORIZED'});
  expect(await processor.process({provider:'ASAAS',tenantId:'pizza-a',
   headers:{'asaas-access-token':secret},payload:body,rawBody:raw})).toEqual(['CONFIRMED']);
  expect((await e.store.get('pizza-a','main',p.id))?.status).toBe('CONFIRMED');
  expect(e.store.outbox.filter(x=>x.kind==='PAYMENT_CONFIRMED')).toHaveLength(1);
  expect(audit.events.size).toBe(1);
  await processor.process({provider:'ASAAS',tenantId:'pizza-a',
   headers:{'asaas-access-token':secret},payload:body,rawBody:raw});
  expect(e.store.outbox.filter(x=>x.kind==='PAYMENT_CONFIRMED')).toHaveLength(1);
 });
 it('mounts HTTP order-payment endpoint under authorization boundaries',async()=>{
  const e=await fixture();
  const app=express();app.use(express.json());
  app.use('/order-payments',(req,_res,next)=>{
   req.tenantContext=tenant(req.header('x-test-tenant')??'pizza-a',
     req.header('x-test-role')??'OWNER');
   next();
  },createOrderPaymentsRouter(e.service));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const path='http://127.0.0.1:'+(server.address() as AddressInfo).port+
     '/order-payments/units/main/orders/order_confirmed001';
   const bad=await fetch(path,{method:'POST',headers:{'content-type':'application/json',
     'x-test-role':'VIEWER'},body:JSON.stringify(online())});
   expect(bad.status).toBe(403);
   const created=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify(online())});
   expect(created.status).toBe(201);
   expect((await created.json()).data).toMatchObject({status:'PENDING',provider:'ASAAS'});
   const foreign=await fetch(path,{headers:{'x-test-tenant':'pizza-b'}});
   expect(foreign.status).toBe(404);
  }finally{server.close();await once(server,'close');}
 });
});
