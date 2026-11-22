import { createHash,randomUUID } from 'node:crypto';
import {requirePilotLiveFeature} from '../operations/pilotFlags';
import type { TenantContext } from '../types/contracts';
import type { OrderRepository } from '../orders/model';
import { requireBusinessScope } from '../business/service';
import type { ProviderPaymentResult } from '../payments/model';
import type { PaymentMethodsService } from '../payments/methods';
import { pagarmeOrderReference } from '../payments/pagarme';
import { OrderPaymentPolicyEngine,allowKeys,denyPayment,paymentId,safeInteger } from './policy';
import type {
  OrderPayment,OrderPaymentRepository,OrderPaymentProviderResolver,
  CreateOrderPaymentInput,ConfirmOfflineCollectionInput,RefundOrderPaymentInput,
  OrderPaymentStatus,OrderPaymentEventKind
} from './model';

const ONLINE=new Set(['PIX','PAYMENT_LINK','CHECKOUT']);
const OFFLINE=new Set(['PIX_MANUAL','CARD_ON_DELIVERY','CASH_ON_DELIVERY']);
const VALID_METHODS=new Set([...ONLINE,...OFFLINE]);
const EXPECTED_STATUSES=new Set(['PENDING','CONFIRMED','FAILED','CANCELLED','EXPIRED','REFUNDED']);
function fingerprint(input:CreateOrderPaymentInput,scope:{tenantId:string;unitId:string;orderId:string}):string {
  const payload={...scope,method:input.method,providerId:input.providerId??null,
    payerEmail:input.payerEmail??null,cashTenderedMinor:input.cashTenderedMinor??null};
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
function expectedReference(provider:string,tenant:string,orderId:string):string {
  if(provider==='PAGARME')return pagarmeOrderReference(tenant,orderId);
  if(provider==='PAGBANK')return 'av-'+createHash('sha256')
    .update(tenant+':'+orderId).digest('hex').slice(0,32);
  return tenant+':'+orderId;
}
function providerVerified(payment:OrderPayment,result:ProviderPaymentResult):void {
  if(result.provider!==payment.provider||!result.providerPaymentId||
    (payment.providerPaymentId&&payment.providerPaymentId!==result.providerPaymentId)||
    result.amountMinor!==payment.amountMinor||
    result.referenceId!==expectedReference(payment.provider,payment.tenantId,payment.orderId)||
    !EXPECTED_STATUSES.has(result.status))
    denyPayment('ORDER_PAYMENT_PSP_RECONCILIATION_FAILED','FORBIDDEN');
  if(result.expiresAt!==undefined&&(!Number.isFinite(Date.parse(result.expiresAt))))
    denyPayment('ORDER_PAYMENT_EXPIRATION_INVALID','PROVIDER');
}
function statusEvent(status:OrderPaymentStatus):OrderPaymentEventKind {
  switch(status){
    case 'CONFIRMED':return 'PAYMENT_CONFIRMED';
    case 'FAILED':return 'PAYMENT_FAILED';
    case 'EXPIRED':return 'PAYMENT_EXPIRED';
    case 'CANCELLED':return 'PAYMENT_CANCELLED';
    case 'REFUND_PENDING':return 'PAYMENT_REFUND_REQUESTED';
    case 'REFUNDED':return 'PAYMENT_REFUNDED';
    case 'RECONCILIATION_REQUIRED':return 'PAYMENT_RECONCILIATION_REQUIRED';
    default:return 'PAYMENT_AWAITING_VERIFICATION';
  }
}
function isVersion(n:unknown):n is number{
  return Number.isSafeInteger(n)&&Number(n)>=1;
}
export class OrderPaymentService {
  constructor(
    private readonly store:OrderPaymentRepository,
    private readonly orders:OrderRepository,
    private readonly resolver:OrderPaymentProviderResolver,
    private readonly methods:PaymentMethodsService,
    private readonly policy:OrderPaymentPolicyEngine=new OrderPaymentPolicyEngine(),
    private readonly clock:()=>Date=()=>new Date(),
  ){}
  private authorize(ctx:TenantContext,unitId:string):{tenantId:string;unitId:string}{
    this.policy.operator(ctx);
    return requireBusinessScope(ctx,unitId);
  }
  async get(ctx:TenantContext,unitId:string,orderId:string):Promise<OrderPayment|null>{
    const s=this.authorize(ctx,unitId);
    paymentId(orderId);
    const order=await this.orders.findById(s.tenantId,s.unitId,orderId);
    if(!order)denyPayment('ORDER_PAYMENT_ORDER_NOT_FOUND','NOT_FOUND');
    return this.store.byOrder(s.tenantId,s.unitId,orderId);
  }
  async create(ctx:TenantContext,unitId:string,orderId:string,input:CreateOrderPaymentInput):Promise<OrderPayment>{
    const scope=this.authorize(ctx,unitId);
    paymentId(orderId);
    allowKeys(input,['method','idempotencyKey','providerId','payerEmail','cashTenderedMinor']);
    if(!VALID_METHODS.has(input.method))denyPayment('ORDER_PAYMENT_METHOD_INVALID','VALIDATION');
    const key=paymentId(input.idempotencyKey);
    if(input.payerEmail!==undefined&&(
      typeof input.payerEmail!=='string'||input.payerEmail.length>254||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payerEmail)))
      denyPayment('ORDER_PAYMENT_EMAIL_INVALID','VALIDATION');
    if(input.providerId!==undefined&&(
      typeof input.providerId!=='string'||! /^[A-Z_]{2,40}$/.test(input.providerId)))
      denyPayment('ORDER_PAYMENT_PROVIDER_INVALID','VALIDATION');
    if(ONLINE.has(input.method)&&input.cashTenderedMinor!==undefined)
      denyPayment('ORDER_PAYMENT_METHOD_FIELDS_INVALID','VALIDATION');
    if(OFFLINE.has(input.method)&&(input.providerId!==undefined||input.payerEmail!==undefined))
      denyPayment('ORDER_PAYMENT_METHOD_FIELDS_INVALID','VALIDATION');
    if(input.method!=='CASH_ON_DELIVERY'&&input.cashTenderedMinor!==undefined)
      denyPayment('ORDER_PAYMENT_CASH_FIELDS_INVALID','VALIDATION');
    const hash=fingerprint(input,{...scope,orderId});
    const existing=await this.store.byIdempotency(scope.tenantId,unitId,key);
    if(existing){
      if(existing.fingerprint!==hash||existing.orderId!==orderId)
        denyPayment('ORDER_PAYMENT_IDEMPOTENCY_CONFLICT');
      return existing;
    }
    const order=await this.orders.findById(scope.tenantId,unitId,orderId);
    if(!order)denyPayment('ORDER_PAYMENT_ORDER_NOT_FOUND','NOT_FOUND');
    this.policy.create(ctx,order);
    let tendered:number|undefined,change:number|undefined;
    if(input.method==='CASH_ON_DELIVERY'&&input.cashTenderedMinor!==undefined){
      tendered=safeInteger(input.cashTenderedMinor,order.totalMinor);
      change=tendered-order.totalMinor;
    }
    if(OFFLINE.has(input.method)){
      if(!(await this.methods.isEnabled(scope.tenantId,input.method as
        'PIX_MANUAL'|'CASH_ON_DELIVERY'|'CARD_ON_DELIVERY')))
        denyPayment('ORDER_PAYMENT_METHOD_DISABLED','FORBIDDEN');
    }
    // Resolve and verify the merchant's actual PSP account BEFORE reserving
    // a charge. No client-supplied recipient, credentials or provider URL.
    if(ONLINE.has(input.method))requirePilotLiveFeature('ONLINE_PAYMENT_CREATE',scope.tenantId,unitId);
    const provider=ONLINE.has(input.method)?
      await this.resolver.forNewPayment(scope.tenantId,input.providerId):undefined;
    if(provider&&input.method!=='PIX'&&
      !provider.supportedMethods?.includes(input.method as 'PAYMENT_LINK'|'CHECKOUT'))
      denyPayment('ORDER_PAYMENT_ONLINE_METHOD_UNSUPPORTED','PROVIDER');
    const request={tenantId:scope.tenantId,customerId:order.customerId,
      referenceId:order.id,amountMinor:order.totalMinor,currency:'BRL' as const,
      idempotencyKey:key,...(input.payerEmail?{payerEmail:input.payerEmail}:{})};
    if(provider&&input.method==='PIX')await provider.preflightPix?.(request);
    const now=this.clock().toISOString();
    const draft:OrderPayment={
      ...scope,orderId,customerId:order.customerId,id:'opay_'+randomUUID().replace(/-/g,''),
      status:'CREATION_RESERVED',version:1,method:input.method,
      amountMinor:order.totalMinor,currency:'BRL',provider:provider?.id??'OFFLINE',
      idempotencyKey:key,fingerprint:hash,createdAt:now,updatedAt:now,
      createdBy:ctx.userId!,...(tendered!==undefined?{cashTenderedMinor:tendered}:{}),
      ...(change!==undefined?{changeMinor:change}:{}),
    };
    const reserved=await this.store.reserve(draft);
    if(!reserved.created)return reserved.payment; // No replay of uncertain external IO.
    const record=reserved.payment;
    if(!provider){
      return this.store.transition({...record,status:'PENDING',version:2,
        updatedAt:this.clock().toISOString()},record.version,'PAYMENT_AWAITING_VERIFICATION');
    }
    try {
      const issued=input.method==='PIX'?await provider.createPix(request):
        input.method==='CHECKOUT'?await provider.createCheckout(request):
        await provider.createPaymentLink(request);
      providerVerified(record,issued);
      if(input.method==='PIX'&&!issued.pixCode)
        denyPayment('ORDER_PAYMENT_PIX_CODE_MISSING','PROVIDER');
      if(input.method!=='PIX'&&(!issued.paymentUrl||
        !/^https:\/\//.test(issued.paymentUrl)))
        denyPayment('ORDER_PAYMENT_CHECKOUT_URL_INVALID','PROVIDER');
      // Never trust a status embedded in the create response for settlement.
      const result=issued.status==='CONFIRMED'?
        await provider.getPaymentStatus(issued.providerPaymentId):issued;
      providerVerified(record,result);
      const status=result.status as OrderPaymentStatus;
      if(status==='REFUNDED')denyPayment('ORDER_PAYMENT_UNEXPECTED_REFUND','PROVIDER');
      return this.store.transition({...record,providerPaymentId:issued.providerPaymentId,
        status,version:2,updatedAt:this.clock().toISOString(),
        ...(issued.paymentUrl?{paymentUrl:issued.paymentUrl}:{}),
        ...(issued.pixCode?{pixCode:issued.pixCode}:{}),
        ...(issued.pixQrCodeBase64?{pixQrCodeBase64:issued.pixQrCodeBase64}:{}),
        ...(issued.expiresAt?{expiresAt:issued.expiresAt}:{}),
        ...(status==='CONFIRMED'?{confirmedAt:this.clock().toISOString(),
          verificationSource:'PSP_GET' as const}:{}),
      },1,statusEvent(status));
    }catch{
      // Provider call MAY have succeeded. Never retry createPix/createCheckout.
      // A pending intent with no PSP ID requires operator/provider investigation.
      await this.store.transition({...record,status:'RECONCILIATION_REQUIRED',
        version:2,updatedAt:this.clock().toISOString()},1,'PAYMENT_RECONCILIATION_REQUIRED');
      denyPayment('ORDER_PAYMENT_CREATION_UNCERTAIN','PROVIDER');
    }
  }
  /** Recover an ambiguous PSP create by supplying a reference independently
   * verified against the merchant-bound provider GET. Never calls createPix.
   */
  async recoverUnknown(ctx:TenantContext,unitId:string,orderId:string,input:{
    expectedVersion:number;providerPaymentId:string;
  }):Promise<OrderPayment>{
    this.policy.owner(ctx);
    allowKeys(input,['expectedVersion','providerPaymentId']);
    if(!isVersion(input.expectedVersion))denyPayment('ORDER_PAYMENT_VERSION_INVALID','VALIDATION');
    const providerPaymentId=paymentId(input.providerPaymentId);
    const record=await this.get(ctx,unitId,orderId);
    if(!record||record.status!=='RECONCILIATION_REQUIRED'||
      record.providerPaymentId||record.version!==input.expectedVersion)
      denyPayment('ORDER_PAYMENT_RECOVERY_NOT_ALLOWED');
    if(record.provider==='OFFLINE')denyPayment('ORDER_PAYMENT_RECOVERY_NOT_ALLOWED');
    const provider=await this.resolver.forRecordedPayment(record);
    const verified=await provider.getPaymentStatus(providerPaymentId);
    providerVerified(record,verified);
    if(verified.providerPaymentId!==providerPaymentId||
      !['PENDING','CONFIRMED','FAILED','EXPIRED','CANCELLED'].includes(verified.status))
      denyPayment('ORDER_PAYMENT_RECOVERY_PSP_MISMATCH');
    const status=verified.status as OrderPaymentStatus;
    const now=this.clock().toISOString();
    return this.store.transition({...record,status,version:record.version+1,
      providerPaymentId,updatedAt:now,
      ...(status==='CONFIRMED'?{confirmedAt:now,verificationSource:'PSP_GET' as const}:{}),
      ...(verified.pixCode?{pixCode:verified.pixCode}:{}),
      ...(verified.expiresAt?{expiresAt:verified.expiresAt}:{}),
      ...(verified.paymentUrl?{paymentUrl:verified.paymentUrl}:{}),
    },record.version,statusEvent(status));
  }
  async refresh(ctx:TenantContext,unitId:string,paymentIdValue:string):Promise<OrderPayment>{
    const scope=this.authorize(ctx,unitId);
    paymentId(paymentIdValue);
    const original=await this.store.get(scope.tenantId,unitId,paymentIdValue);
    if(!original)denyPayment('ORDER_PAYMENT_NOT_FOUND','NOT_FOUND');
    return this.refreshVerified(original);
  }
  async refreshVerified(original:OrderPayment):Promise<OrderPayment>{
    if(original.provider==='OFFLINE'||!original.providerPaymentId)return original;
    if(original.status==='REFUNDED')return original;
    const provider=await this.resolver.forRecordedPayment(original);
    const checked=await provider.getPaymentStatus(original.providerPaymentId);
    providerVerified(original,checked);
    const next=checked.status as OrderPaymentStatus;
    if(original.status===next)return original;
    if(original.status==='CONFIRMED'&&next!=='REFUNDED')return original;
    if(original.status==='REFUND_PENDING'&&next!=='REFUNDED')return original;
    if(['FAILED','CANCELLED','EXPIRED'].includes(original.status)&&next!=='CONFIRMED')
      return original;
    if(next==='REFUNDED'&&!original.refund)
      denyPayment('ORDER_PAYMENT_REFUND_UNRECOGNIZED','CONFLICT');
    const now=this.clock().toISOString();
    return this.store.transition({...original,status:next,version:original.version+1,
      updatedAt:now,...(next==='CONFIRMED'?{confirmedAt:original.confirmedAt??now,
        verificationSource:'PSP_GET' as const}:{}),
      ...(next==='REFUNDED'?{verificationSource:'PSP_GET' as const}:{})},
    original.version,statusEvent(next));
  }
  async refreshFromWebhook(tenantId:string,provider:string,providerId:string):Promise<OrderPayment|null>{
    const payment=await this.store.byProvider(tenantId,provider,providerId);
    return payment?this.refreshVerified(payment):null;
  }
  async collect(ctx:TenantContext,unitId:string,orderId:string,
    input:ConfirmOfflineCollectionInput):Promise<OrderPayment>{
    this.policy.collect(ctx);
    allowKeys(input,['expectedVersion','amountMinor','receiptRef','receivedMinor']);
    if(!isVersion(input.expectedVersion))denyPayment('ORDER_PAYMENT_VERSION_INVALID','VALIDATION');
    const payment=await this.get(ctx,unitId,orderId);
    if(!payment)denyPayment('ORDER_PAYMENT_NOT_FOUND','NOT_FOUND');
    if(payment.provider!=='OFFLINE'||!['CARD_ON_DELIVERY','CASH_ON_DELIVERY'].includes(payment.method)||
      payment.status!=='PENDING'||payment.version!==input.expectedVersion)
      denyPayment('ORDER_PAYMENT_COLLECTION_NOT_ALLOWED');
    if(input.amountMinor!==payment.amountMinor)
      denyPayment('ORDER_PAYMENT_COLLECTION_AMOUNT_MISMATCH');
    const receiptRef=paymentId(input.receiptRef);
    // Require a recognizable POS/cash-register receipt identifier; bare card
    // numbers, CVV and payer input are never valid settlement evidence.
    if(!/^(?=.*[A-Za-z])[A-Za-z0-9_:-]{8,96}$/.test(receiptRef)||
      /\d{13,19}/.test(receiptRef))
      denyPayment('ORDER_PAYMENT_RECEIPT_INVALID','VALIDATION');
    let actualTendered:number|undefined;
    if(payment.method==='CASH_ON_DELIVERY'){
      if(input.receivedMinor===undefined)
        denyPayment('ORDER_PAYMENT_CASH_RECEIVED_REQUIRED','VALIDATION');
      actualTendered=safeInteger(input.receivedMinor,payment.amountMinor);
    }else if(input.receivedMinor!==undefined){
      denyPayment('ORDER_PAYMENT_CARD_CASH_FIELD_INVALID','VALIDATION');
    }
    const now=this.clock().toISOString();
    return this.store.transition({...payment,version:payment.version+1,status:'CONFIRMED',
      updatedAt:now,confirmedAt:now,verifiedBy:ctx.userId!,
      ...(actualTendered!==undefined?{cashTenderedMinor:actualTendered,
        changeMinor:actualTendered-payment.amountMinor}:{}),
      verificationSource:'OPERATOR_COD',receiptRef},payment.version,'PAYMENT_CONFIRMED');
  }
  async refund(ctx:TenantContext,unitId:string,orderId:string,
    input:RefundOrderPaymentInput):Promise<OrderPayment>{
    this.policy.owner(ctx);
    allowKeys(input,['expectedVersion','reason']);
    if(!isVersion(input.expectedVersion))denyPayment('ORDER_PAYMENT_VERSION_INVALID','VALIDATION');
    const record=await this.get(ctx,unitId,orderId);
    if(!record)denyPayment('ORDER_PAYMENT_NOT_FOUND','NOT_FOUND');
    if(record.status!=='CONFIRMED'||record.version!==input.expectedVersion)
      denyPayment('ORDER_PAYMENT_REFUND_NOT_ALLOWED');
    if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>240)
      denyPayment('ORDER_PAYMENT_REFUND_REASON_INVALID','VALIDATION');
    if(record.providerPaymentId)
      requirePilotLiveFeature('PSP_REFUND',record.tenantId,record.unitId);
    const now=this.clock().toISOString();
    const pending=await this.store.transition({
      ...record,status:'REFUND_PENDING',version:record.version+1,updatedAt:now,
      refund:{reason:input.reason.trim(),requestedBy:ctx.userId!,requestedAt:now},
    },record.version,'PAYMENT_REFUND_REQUESTED');
    if(!pending.providerPaymentId)return pending; // Offline: manual resolution; never fabricate refund.
    const provider=await this.resolver.forRecordedPayment(pending);
    try{
      const result=await provider.refundPayment(pending.providerPaymentId);
      providerVerified(pending,result);
      // PSP refund may be asynchronous. Never mark REFUNDED without a GET.
      return await this.refreshVerified(pending);
    }catch{return pending;} // Governed pending, no blind automatic replay.
  }
}
