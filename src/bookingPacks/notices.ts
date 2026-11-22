import type {Booking,BookingNotice,ScheduleRepository,ScheduleScope} from '../scheduling/model';
import type {TenantContext} from '../types/contracts';
import type {CustomerRepository} from '../customers/contracts';
import type {VerifiedCustomerChannel} from '../fulfillment/trustedChannelIdentity';
import type {ContactConsentRepository} from '../governance/repository';
import type {WhatsAppCustomerServicePolicy,WhatsAppSendInput} from '../channels/whatsappDelivery';
import {requirePilotLiveFeature} from '../operations/pilotFlags';
import {requireBusinessAdmin} from '../business/service';
import {id,integer,object,reject} from '../scheduling/rules';
import {SchedulingService} from '../scheduling/service';
import {appointmentParameter,bookingTemplateBody,type PackUtilityTemplatePort} from './templates';

export interface PackIdentityPort{get(t:string,c:string,channel:'WHATSAPP',u:string):Promise<VerifiedCustomerChannel|null>;}
export interface PackSender{
 send(input:WhatsAppSendInput):Promise<{externalMessageId:string;duplicate:boolean}>;
}
const lease=120_000;
export function packNoticeEligible(b:Booking,n:BookingNotice,now:number){
 if(!b.pack?.notifyWhatsApp)return false;
 if(n.kind==='CANCELLATION')return b.status==='CANCELLED'&&now<n.dueMs+86400000;
 if(b.status!=='CONFIRMED'||b.startMs<=now||b.checkedInAt)return false;
 return n.kind!=='REMINDER'||b.reminder?.state==='READY';
}
/** No service name, diagnosis, treatment, payment status or client name in messages.
 * The channel connection identifies the business; all message facts come from
 * the claimed persisted booking, never the HTTP body or LLM.
 */
export function noticeText(b:Booking,n:BookingNotice){
 return bookingTemplateBody(n.kind).replace('{{1}}',appointmentParameter(b));
}
export class PackNoticeService{
 constructor(private readonly store:ScheduleRepository,private readonly scheduling:SchedulingService,
  private readonly customers:Pick<CustomerRepository,'findById'>,
  private readonly identities:PackIdentityPort,
  private readonly consent:Pick<ContactConsentRepository,'get'>,
  private readonly window:WhatsAppCustomerServicePolicy,
  private readonly sender:PackSender,
  private readonly live:(s:ScheduleScope)=>void=s=>{
   if(process.env.NODE_ENV!=='test'&&process.env.ATENDEVENDE_BOOKING_WHATSAPP_LIVE_ENABLED!=='true')
    return reject('PACK_WHATSAPP_LIVE_DISABLED','FORBIDDEN');
   requirePilotLiveFeature('WHATSAPP_OUTBOUND',s.tenantId,s.unitId);
  },private readonly templates?:PackUtilityTemplatePort){}
 private update(b:Booking,notices:BookingNotice[],now:number,actor='BOOKING_NOTICE_WORKER'):Booking{
  return {...b,notices,version:b.version+1,updatedAt:new Date(now).toISOString(),transitionBy:actor};
 }
 private async settle(s:ScheduleScope,bid:string,key:string,patch:Partial<BookingNotice>){
  return this.store.transact(s,async tx=>{
   const b=await tx.booking(bid),n=b?.notices?.find(x=>x.key===key);
   if(!b||!n||n.state!=='CLAIMED')return false;
   const now=this.scheduling.now();
   tx.saveBooking(this.update(b,b.notices!.map(x=>x.key===key?{...x,...patch}:x),now));
   return true;
  });
 }
 private async trusted(s:ScheduleScope,b:Booking):Promise<string|null>{
  const [customer,identity,consent]=await Promise.all([
   this.customers.findById(s.tenantId,b.customerId),this.identities.get(s.tenantId,b.customerId,'WHATSAPP',s.unitId),
   this.consent.get(s.tenantId,s.unitId,b.customerId)]);
  const now=this.scheduling.now();
  if(!customer||customer.tenantId!==s.tenantId||customer.id!==b.customerId||customer.status!=='ACTIVE'||
   !identity||identity.tenantId!==s.tenantId||identity.customerId!==b.customerId||identity.channel!=='WHATSAPP'||
   identity.revokedAt||identity.provenance!=='SIGNED_PROVIDER_WEBHOOK'||!identity.proofRef||
   !Number.isFinite(Date.parse(identity.verifiedAt))||Date.parse(identity.verifiedAt)>now||
   identity.recipient!==customer.phone||!/^[1-9]\d{9,14}$/.test(identity.recipient)||
   !consent||consent.tenantId!==s.tenantId||consent.unitId!==s.unitId||consent.customerId!==b.customerId||
   consent.channel!=='WHATSAPP'||consent.preference!=='OPT_IN'||consent.provenance!=='SIGNED_PROVIDER_WEBHOOK'||
   !consent.providerEventId||!Number.isFinite(Date.parse(consent.recordedAt))||Date.parse(consent.recordedAt)>now||
   consent.recipient!==identity.recipient)return null;
  return identity.recipient;
 }
 /** No automatic retry for a claimed or possibly sent message. A dead process
  * transitions to REVIEW_REQUIRED, never to PENDING. Preflight denials are
  * BLOCKED and may be requeued explicitly after consent/configuration changes.
  */
 async processOne(s:ScheduleScope,bid:string){
  const claim=await this.store.transact(s,async tx=>{
   const now=this.scheduling.now(),b=await tx.booking(id(bid));
   if(!b?.notices?.length)return null;
   const inFlight=b.notices.find(n=>n.state==='CLAIMED');
   if(inFlight){
    if((inFlight.claimUntilMs??0)>now)return null;
    tx.saveBooking(this.update(b,b.notices.map(n=>n.state==='CLAIMED'?
     {...n,state:'REVIEW_REQUIRED',failureCode:'CLAIM_EXPIRED'}:n),now));
    return null;
   }
   const n=b.notices.find(x=>x.state==='PENDING'&&x.dueMs<=now);
   if(!n)return null;
   const config=await tx.config();
   const grant=!!b.pack&&await tx.grant(now,b.pack.kind);
   if(!packNoticeEligible(b,n,now)||!grant||!config?.pack?.notifyWhatsApp||config.pack.kind!==b.pack?.kind){
    tx.saveBooking(this.update(b,b.notices.map(x=>x.key===n.key?
     {...x,state:'SUPERSEDED',failureCode:'NOTICE_NO_LONGER_AUTHORIZED'}:x),now));
    return null;
   }
   const claimed:BookingNotice={...n,state:'CLAIMED',claimUntilMs:now+lease};
   const next=this.update(b,b.notices.map(x=>x.key===n.key?claimed:x),now);
   tx.saveBooking(next);return {booking:next,notice:claimed};
  });
  if(!claim)return 'NO_ACTION' as const;
  const {booking:b,notice:n}=claim;
  let recipient:string,prepared:(()=>Promise<{externalMessageId:string;duplicate:boolean}>)|undefined;
  try{
   this.live(s);
   const verified=await this.trusted(s,b);
   if(!verified){
    await this.settle(s,b.id,n.key,{state:'BLOCKED',failureCode:'VERIFIED_CONSENT_REQUIRED'});
    return 'BLOCKED' as const;
   }
   if(!await this.window.hasRecentVerifiedInbound(s.tenantId,s.unitId,verified)){
    const name=b.pack?.utilityTemplates?.[n.kind];
    if(!name||!this.templates){
     await this.settle(s,b.id,n.key,{state:'BLOCKED',failureCode:'WHATSAPP_WINDOW_CLOSED'});
     return 'BLOCKED' as const;
    }
    prepared=await this.templates.prepare({...s,recipient:verified,name,kind:n.kind,
     parameter:appointmentParameter(b),idempotencyKey:n.key});
   }
   recipient=verified;
   // Recheck persisted state and unit authorization immediately before send.
   const allowed=await this.store.transact(s,async tx=>{
    const current=await tx.booking(b.id),cfg=await tx.config(),now=this.scheduling.now();
    return !!current&&current.version===b.version&&packNoticeEligible(current,n,now)&&
     (n.claimUntilMs??0)>now&&!!cfg?.pack?.notifyWhatsApp&&cfg.pack.kind===b.pack?.kind&&
     (!prepared||cfg.pack.utilityTemplates?.[n.kind]===b.pack?.utilityTemplates?.[n.kind])&&
     await tx.grant(now,b.pack!.kind);
   });
   if(!allowed){
    await this.settle(s,b.id,n.key,{state:'BLOCKED',failureCode:'NOTICE_STALE'});
    return 'BLOCKED' as const;
   }
   // Consent can be revoked independently of booking state: re-read before side effect.
   if(await this.trusted(s,b)!==recipient){
    await this.settle(s,b.id,n.key,{state:'BLOCKED',failureCode:'VERIFIED_CONSENT_REQUIRED'});
    return 'BLOCKED' as const;
   }
  }catch{
   await this.settle(s,b.id,n.key,{state:'BLOCKED',failureCode:'NOTICE_PREFLIGHT_DENIED'});
   return 'BLOCKED' as const;
  }
  try{
   const sent=prepared?await prepared():await this.sender.send({...s,recipient,text:noticeText(b,n),idempotencyKey:n.key,
    authorizedCustomerServiceWindow:true});
   if(!/^wamid\.[A-Za-z0-9._=-]{4,220}$/.test(sent.externalMessageId))throw Error('missing provider proof');
   const ok=await this.settle(s,b.id,n.key,{state:'ACCEPTED_BY_PROVIDER',externalMessageId:sent.externalMessageId});
   return ok?'ACCEPTED_BY_PROVIDER' as const:'REVIEW_REQUIRED' as const;
  }catch{
   await this.settle(s,b.id,n.key,{state:'REVIEW_REQUIRED',failureCode:'NOTICE_PROVIDER_OUTCOME_UNKNOWN'});
   return 'REVIEW_REQUIRED' as const;
  }
 }
 async cycle(s:ScheduleScope){
  const due=await this.store.transact(s,tx=>tx.communicationDue(this.scheduling.now()));
  let accepted=0,blocked=0,review=0;
  for(const row of due){
   const result=await this.processOne(s,row.id);
   if(result==='ACCEPTED_BY_PROVIDER')accepted++;
   if(result==='BLOCKED')blocked++;
   if(result==='REVIEW_REQUIRED')review++;
  }
  return {accepted,blocked,review};
 }
 async retryBlocked(ctx:TenantContext,u:string,bid:string,raw:unknown){
  requireBusinessAdmin(ctx);
  const s=this.scheduling.scope(ctx,u,true),a=object(raw,['expectedVersion','noticeKey']);
  const key=id(a.noticeKey),v=integer(a.expectedVersion,1,100000);
  return this.store.transact(s,async tx=>{
   const now=this.scheduling.now(),b=await tx.booking(id(bid)),cfg=await tx.config();
   if(!b)return reject('SCHEDULE_BOOKING_NOT_FOUND','NOT_FOUND');
   const n=b.notices?.find(x=>x.key===key);
   if(!n||n.state!=='BLOCKED'||b.version!==v||!packNoticeEligible(b,n,now)||
    !cfg?.pack?.notifyWhatsApp||cfg.pack.kind!==b.pack?.kind||!await tx.grant(now,b.pack!.kind))
    return reject('PACK_NOTICE_RETRY_DENIED','CONFLICT');
   // A later lifecycle transition supersedes a blocked event as well.
   if(n.kind!=='REMINDER'&&b.notices!.some(x=>x.key!==key&&x.kind!=='REMINDER'&&x.dueMs>=n.dueMs&&x.state!=='SUPERSEDED'))
    return reject('PACK_NOTICE_RETRY_DENIED','CONFLICT');
   const {claimUntilMs:_lease,failureCode:_code,...rest}=n;
   const next=this.update(b,b.notices!.map(x=>x.key===key?{...rest,state:'PENDING'}:x),now,ctx.userId!);
   tx.saveBooking(next);return next;
  });
 }
}
