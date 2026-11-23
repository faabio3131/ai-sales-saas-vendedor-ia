import {createHash} from 'node:crypto';
import type {TenantContext} from '../types/contracts';
import type {RetailOrder,Scope} from './model';
import {RetailService} from './service';
import type {PaymentProviderInterface} from '../payments/contracts';
import type {ProviderPaymentResult} from '../payments/model';
import {pagarmeOrderReference} from '../payments/pagarme';
import {requirePilotLiveFeature} from '../operations/pilotFlags';
import {requireBusinessAdmin} from '../business/service';
import {id,object,integer,reject} from '../scheduling/rules';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface RetailProviderResolver{
 forNewPayment(t:string,providerId?:string):Promise<PaymentProviderInterface>;
 forNewPaymentWithBinding?(t:string,providerId?:string):Promise<{provider:PaymentProviderInterface;bindingHash:string}>;
 forRecordedPayment?(record:{tenantId:string;provider:string;merchantBindingHash?:string}):Promise<PaymentProviderInterface>;
}
function ref(provider:string,t:string,b:string){
 if(provider==='PAGARME')return pagarmeOrderReference(t,b);
 if(provider==='PAGBANK')return 'av-'+createHash('sha256').update(t+':'+b).digest('hex').slice(0,32);
 return t+':'+b;
}
export class RetailPaymentService{
 constructor(private readonly retail:RetailService,private readonly providers:RetailProviderResolver,
  private readonly live:(s:Scope)=>void=s=>{
   if(process.env.NODE_ENV!=='test'&&process.env.ATENDEVENDE_RETAIL_PAYMENT_LIVE_ENABLED!=='true')return reject('RETAIL_PAYMENT_LIVE_DISABLED','FORBIDDEN');
   requirePilotLiveFeature('ONLINE_PAYMENT_CREATE',s.tenantId,s.unitId);
  }){}
 private patch(b:RetailOrder,ctx:TenantContext,payment:RetailOrder['payment']):RetailOrder{
  return {...b,payment,version:b.version+1,actorId:ctx.userId!,updatedAt:new Date(this.retail.now()).toISOString()};
 }
 async issue(ctx:TenantContext,u:string,bid:string,raw:unknown){
  const s=this.retail.scope(ctx,u,true),a=object(raw,['expectedVersion','idempotencyKey','providerId']),v=integer(a.expectedVersion,1,100000000),k=id(a.idempotencyKey),bId=id(bid);
  if(!['OWNER','ADMIN','MANAGER','CASHIER'].includes(ctx.role??''))return reject('RETAIL_PAYMENT_ROLE_REQUIRED','FORBIDDEN');
  this.live(s);const providerId=a.providerId===undefined?undefined:id(a.providerId),fingerprint=hash(['PIX',bId,v,providerId??null]);
  const prior=await this.retail.store.transact(s,async tx=>{
   const r=await tx.receipt(k);if(!r)return null;
   if(r.fingerprint!==fingerprint)return reject('RETAIL_IDEMPOTENCY_CONFLICT','CONFLICT');return tx.order(r.orderId);
  });if(prior)return prior;
  const selected=this.providers.forNewPaymentWithBinding?
   await this.providers.forNewPaymentWithBinding(s.tenantId,providerId):undefined;
  const p=selected?.provider??await this.providers.forNewPayment(s.tenantId,providerId);
  const claim=await this.retail.store.transact(s,async tx=>{
   const r=await tx.receipt(k);
   if(r){if(r.fingerprint!==fingerprint)return reject('RETAIL_IDEMPOTENCY_CONFLICT','CONFLICT');const b=await tx.order(r.orderId);if(!b)return reject('RETAIL_ORDER_NOT_FOUND','NOT_FOUND');return {b,created:false};}
   await this.retail.grant(tx,['RETAIL_CATALOG','RETAIL_CHECKOUT'],true,'PAYMENTS');
   const b=await tx.order(bId);if(!b)return reject('RETAIL_ORDER_NOT_FOUND','NOT_FOUND');
   if(b.version!==v||b.status!=='CONFIRMED'||b.payment.state!=='UNPAID'||b.totalMinor<=0)return reject('RETAIL_PAYMENT_STATE','CONFLICT');
   const next=this.patch(b,ctx,{state:'CREATING',method:'PIX',provider:p.id,referenceId:ref(p.id,s.tenantId,b.id),
    ...(selected?{merchantBindingHash:selected.bindingHash}:{})});
   tx.saveOrder(next);tx.saveReceipt(k,{fingerprint,orderId:b.id});return {b:next,created:true};
  });
  if(!claim.created)return claim.b;
  try{
   const result=await p.createPix({tenantId:s.tenantId,customerId:claim.b.customerId,referenceId:bId,
    amountMinor:claim.b.totalMinor,currency:'BRL',idempotencyKey:'retail_'+hash([s.tenantId,s.unitId,bId]).slice(0,48)});
   return await this.persist(ctx,s,bId,result,false);
  }catch{
   return this.retail.store.transact(s,async tx=>{
    const b=await tx.order(bId);if(!b)return reject('RETAIL_ORDER_NOT_FOUND','NOT_FOUND');
    if(b.payment.state!=='CREATING')return b;
    const next=this.patch(b,ctx,{...b.payment,state:'REVIEW_REQUIRED'});tx.saveOrder(next);return next;
   });
  }
 }
 private async persist(ctx:TenantContext,s:Scope,bid:string,r:ProviderPaymentResult,verified:boolean){
  return this.retail.store.transact(s,async tx=>{
   const b=await tx.order(bid);if(!b)return reject('RETAIL_ORDER_NOT_FOUND','NOT_FOUND');
   if(r.provider!==b.payment.provider||!r.providerPaymentId||r.referenceId!==b.payment.referenceId||r.amountMinor!==b.totalMinor||
      b.payment.providerPaymentId&&b.payment.providerPaymentId!==r.providerPaymentId)return reject('RETAIL_PSP_MISMATCH','FORBIDDEN');
   const state=r.status==='REFUNDED'&&verified?'REFUNDED':b.status==='CANCELLED'?'REVIEW_REQUIRED':
    r.status==='CONFIRMED'&&verified?'VERIFIED':r.status==='PENDING'||r.status==='CONFIRMED'?'PENDING':'REVIEW_REQUIRED';
   const finalState=(b.payment.state==='VERIFIED'||b.payment.state==='REFUNDED')&&state!==b.payment.state&&state!=='REFUNDED'?'REVIEW_REQUIRED':state;
   const {pixCode:_old,...old}=b.payment;
   const payment:RetailOrder['payment']={...old,state:finalState,providerPaymentId:r.providerPaymentId,
    ...(finalState==='PENDING'&&(r.pixCode??_old)?{pixCode:r.pixCode??_old}:{}),
    ...(verified?{verifiedAt:new Date(this.retail.now()).toISOString()}: {})};
   const next=this.patch(b,ctx,payment);tx.saveOrder(next);return next;
  });
 }
 async markUncertain(ctx:TenantContext,u:string,bid:string,raw:unknown){
  requireBusinessAdmin(ctx);const s=this.retail.scope(ctx,u,true),a=object(raw,['expectedVersion']),v=integer(a.expectedVersion,1,100000000);
  return this.retail.store.transact(s,async tx=>{
   const b=await tx.order(id(bid));if(!b)return reject('RETAIL_ORDER_NOT_FOUND','NOT_FOUND');
   if(b.version!==v||b.payment.state!=='CREATING'||this.retail.now()-Date.parse(b.updatedAt)<120000)return reject('RETAIL_PAYMENT_CLAIM_NOT_EXPIRED','CONFLICT');
   const next=this.patch(b,ctx,{...b.payment,state:'REVIEW_REQUIRED'});tx.saveOrder(next);return next;
  });
 }
 async refresh(ctx:TenantContext,u:string,bid:string,raw:unknown){
  const s=this.retail.scope(ctx,u,true),a=object(raw,['providerPaymentId']);
  if(!['OWNER','ADMIN','MANAGER','CASHIER'].includes(ctx.role??''))return reject('RETAIL_PAYMENT_ROLE_REQUIRED','FORBIDDEN');
  if(a.providerPaymentId!==undefined)requireBusinessAdmin(ctx);
  const b=await this.retail.get(ctx,u,id(bid)),pid=a.providerPaymentId??b.payment.providerPaymentId;
  if(!b.payment.provider||typeof pid!=='string'||!pid.trim()||pid.length>200||b.payment.providerPaymentId&&b.payment.providerPaymentId!==pid)return reject('RETAIL_PSP_REFERENCE_REQUIRED');
  const p=this.providers.forRecordedPayment?
   await this.providers.forRecordedPayment({tenantId:s.tenantId,provider:b.payment.provider,
    merchantBindingHash:b.payment.merchantBindingHash}):
   await this.providers.forNewPayment(s.tenantId,b.payment.provider);
  if(p.id!==b.payment.provider)return reject('RETAIL_PSP_MISMATCH','FORBIDDEN');
  const r=await p.getPaymentStatus(pid);if(r.providerPaymentId!==pid)return reject('RETAIL_PSP_MISMATCH','FORBIDDEN');
  return this.persist(ctx,s,b.id,r,true);
 }
}
