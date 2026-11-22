import {createHash} from 'node:crypto';
import type {TenantContext} from '../types/contracts';
import type {PaymentProviderInterface} from '../payments/contracts';
import type {ProviderPaymentResult} from '../payments/model';
import {pagarmeOrderReference} from '../payments/pagarme';
import {requirePilotLiveFeature} from '../operations/pilotFlags';
import {requireBusinessAdmin} from '../business/service';
import type {Booking,ScheduleRepository,ScheduleScope} from './model';
import {SchedulingService} from './service';
import {id,integer,object,reject} from './rules';

export interface DepositProviderResolver{
 forNewPayment(tenantId:string,providerId?:string):Promise<PaymentProviderInterface>;
}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function reference(provider:string,t:string,b:string){
 if(provider==='PAGARME')return pagarmeOrderReference(t,b);
 if(provider==='PAGBANK')return 'av-'+createHash('sha256').update(t+':'+b).digest('hex').slice(0,32);
 return t+':'+b;
}
function verified(b:Booking,r:ProviderPaymentResult){
 if(r.provider!==b.deposit.provider||!r.providerPaymentId||
  (b.deposit.providerPaymentId&&r.providerPaymentId!==b.deposit.providerPaymentId)||
  r.referenceId!==b.deposit.referenceId||r.amountMinor!==b.deposit.amountMinor||
  !['PENDING','CONFIRMED','FAILED','CANCELLED','EXPIRED','REFUNDED'].includes(r.status))
   return reject('SCHEDULE_DEPOSIT_PSP_MISMATCH','FORBIDDEN');
}
export class BookingDepositService{
 constructor(private readonly store:ScheduleRepository,private readonly scheduling:SchedulingService,
  private readonly resolver:DepositProviderResolver,
  private readonly live:(scope:ScheduleScope)=>void=s=>requirePilotLiveFeature('ONLINE_PAYMENT_CREATE',s.tenantId,s.unitId)){}
 private update(b:Booking,ctx:TenantContext,deposit:Booking['deposit']):Booking{
  return {...b,deposit,version:b.version+1,updatedAt:new Date(this.scheduling.now()).toISOString(),transitionBy:ctx.userId!};
 }
 async issue(ctx:TenantContext,u:string,bookingId:string,raw:unknown){
  const s=this.scheduling.scope(ctx,u,true),a=object(raw,['expectedVersion','idempotencyKey','providerId']);
  const bid=id(bookingId),v=integer(a.expectedVersion,1,100000),key=id(a.idempotencyKey);
  const providerId=a.providerId===undefined?undefined:id(a.providerId);
  this.live(s);
  const hash=digest(['DEPOSIT_PIX',bid,v,providerId??null]);
  // Replays never call a provider. Persist claim before any external side effect.
  const replay=await this.store.transact(s,async tx=>{
   const r=await tx.receipt(key);
   if(!r)return null;
   if(r.fingerprint!==hash)return reject('SCHEDULE_IDEMPOTENCY_CONFLICT','CONFLICT');
   return tx.booking(r.bookingId);
  });
  if(replay)return replay;
  const provider=await this.resolver.forNewPayment(s.tenantId,providerId);
  const claim=await this.store.transact(s,async tx=>{
   const prior=await tx.receipt(key);
   if(prior){
    if(prior.fingerprint!==hash)return reject('SCHEDULE_IDEMPOTENCY_CONFLICT','CONFLICT');
    const b=await tx.booking(prior.bookingId);
    if(!b)return reject('SCHEDULE_BOOKING_NOT_FOUND','NOT_FOUND');
    return {booking:b,created:false};
   }
   const b=await tx.booking(bid),now=this.scheduling.now();
   if(!b)return reject('SCHEDULE_BOOKING_NOT_FOUND','NOT_FOUND');
   if(!await tx.grant(now))return reject('SCHEDULE_CAPABILITY_REQUIRED','FORBIDDEN');
   if(b.version!==v||b.status!=='HELD'||b.holdUntilMs<=now||b.deposit.status!=='UNPAID')
    return reject('SCHEDULE_DEPOSIT_STATE_CONFLICT','CONFLICT');
   const next=this.update(b,ctx,{...b.deposit,status:'CREATING',provider:provider.id,
    referenceId:reference(provider.id,s.tenantId,b.id)});
   tx.saveBooking(next);tx.saveReceipt(key,{fingerprint:hash,bookingId:bid});
   return {booking:next,created:true};
  });
  if(!claim.created)return claim.booking;
  try{
   const request={tenantId:s.tenantId,customerId:claim.booking.customerId,
    referenceId:bid,amountMinor:claim.booking.deposit.amountMinor,currency:'BRL' as const,
    idempotencyKey:'schedule_'+digest([s.tenantId,s.unitId,bid]).slice(0,48)};
   const result=await provider.createPix(request);
   verified(claim.booking,result);
   return await this.persist(ctx,s,bid,result,false);
  }catch{
   // Unknown external outcome is never blindly retried, and cannot confirm a booking.
   return this.store.transact(s,async tx=>{
    const b=await tx.booking(bid);
    if(!b)return reject('SCHEDULE_BOOKING_NOT_FOUND','NOT_FOUND');
    if(b.deposit.status!=='CREATING')return b;
    const next=this.update(b,ctx,{...b.deposit,status:'REVIEW_REQUIRED'});
    tx.saveBooking(next);return next;
   });
  }
 }
 private async persist(ctx:TenantContext,s:ScheduleScope,bid:string,r:ProviderPaymentResult,fromGet:boolean){
  return this.store.transact(s,async tx=>{
   const b=await tx.booking(bid);
   if(!b)return reject('SCHEDULE_BOOKING_NOT_FOUND','NOT_FOUND');
   verified(b,r);
   const now=this.scheduling.now(),active=(b.status==='HELD'&&b.holdUntilMs>now)||b.status==='CONFIRMED';
   let status:Booking['deposit']['status']='REVIEW_REQUIRED';
   if(r.status==='REFUNDED')status='REFUNDED';
   else if(!active)status='REVIEW_REQUIRED';
   else if(r.status==='CONFIRMED')status=fromGet?'CONFIRMED':'PENDING';
   else if(r.status==='PENDING')status='PENDING';
   else status='FAILED';
   // Never downgrade a verified settled payment on a stale/out-of-order provider result.
   if(b.deposit.status==='CONFIRMED'&&status!=='CONFIRMED'&&status!=='REFUNDED')
    status='REVIEW_REQUIRED';
   if(b.deposit.status==='REFUNDED'&&status!=='REFUNDED')status='REVIEW_REQUIRED';
   const {pixCode:oldPix,...prior}=b.deposit;
   const pix=r.pixCode??oldPix;
   const deposit:Booking['deposit']={...prior,providerPaymentId:r.providerPaymentId,status,
    ...(status==='PENDING'&&pix?{pixCode:pix}:{}),
    ...(fromGet?{verifiedAt:new Date(now).toISOString()}:{} )};
   if(JSON.stringify(deposit)===JSON.stringify(b.deposit))return b;
   const next=this.update(b,ctx,deposit);tx.saveBooking(next);return next;
  });
 }
 async refresh(ctx:TenantContext,u:string,bookingId:string,raw:unknown){
  const s=this.scheduling.scope(ctx,u,true),a=object(raw,['providerPaymentId']);
  const bid=id(bookingId);
  // Manual recovery of a lost PSP response requires OWNER/ADMIN, then PSP GET
  // and exact amount/merchant/reference validation; the body cannot assert paid.
  if(a.providerPaymentId!==undefined)requireBusinessAdmin(ctx);
  const b=await this.scheduling.get(ctx,u,bid);
  if(!b.deposit.provider||!b.deposit.referenceId)return reject('SCHEDULE_DEPOSIT_NOT_ISSUED','CONFLICT');
  const p=a.providerPaymentId??b.deposit.providerPaymentId;
  if(typeof p!=='string'||!p.trim()||p.length>200||/[\u0000-\u001f]/.test(p))
   return reject('SCHEDULE_DEPOSIT_PROVIDER_ID_REQUIRED');
  if(b.deposit.providerPaymentId&&p!==b.deposit.providerPaymentId)
   return reject('SCHEDULE_DEPOSIT_PROVIDER_ID_CONFLICT','CONFLICT');
  const provider=await this.resolver.forNewPayment(s.tenantId,b.deposit.provider);
  if(provider.id!==b.deposit.provider)return reject('SCHEDULE_DEPOSIT_PSP_MISMATCH','FORBIDDEN');
  const r=await provider.getPaymentStatus(p);
  if(r.providerPaymentId!==p)return reject('SCHEDULE_DEPOSIT_PSP_MISMATCH','FORBIDDEN');
  return this.persist(ctx,s,bid,r,true);
 }
}
