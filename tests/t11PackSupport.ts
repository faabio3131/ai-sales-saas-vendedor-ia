import type {BookingPack,ScheduleScope} from '../src/scheduling/model';
import {MemorySchedule,config,actor,scope,BASE,input,customerRepo} from './t10ScheduleSupport';
import {SchedulingService} from '../src/scheduling/service';
import {PackNoticeService} from '../src/bookingPacks/notices';
import {vi} from 'vitest';
import type {Customer} from '../src/customers/model';
import type {VerifiedCustomerChannel} from '../src/fulfillment/trustedChannelIdentity';
import type {TrustedContactConsent} from '../src/governance/model';
export const PHONE='5511999990000';
export function packConfig(kind:BookingPack,depositMinor=0,notifyWhatsApp=true){
 const c=config(depositMinor);
 const names:Record<BookingPack,string>={SALON:'Corte e escova',BARBERSHOP:'Corte masculino',AESTHETICS_ADMIN:'Avaliação presencial',PROFESSIONAL_SERVICES:'Consulta administrativa'};
 return {...c,professionals:c.professionals.map(p=>({...p,title:'Profissional habilitado'})),
  services:c.services.map((s,i)=>({...s,name:i===0?names[kind]:'Segundo serviço',
   priceMinor:10000,category:'Atendimento presencial'})),
  pack:{kind,cancelNoticeMinutes:120,noShowGraceMinutes:15,notifyWhatsApp}};
}
export function packInput(tenant='tenant-a',start='2026-11-23T14:00:00Z',key='reserve-1'){
 return {...input(tenant,start,key),acceptedPolicyVersion:1};
}
export async function packFixture(kind:BookingPack='SALON',depositMinor=0,notifyWhatsApp=true){
 let now=BASE;
 const store=new MemorySchedule(),customers={findById:async(t:string,id:string):Promise<Customer|null>=>{
  const c=await customerRepo.findById(t,id);return c?{...c,phone:PHONE}:null;
 }};
 const service=new SchedulingService(store,customers,()=>new Date(now));
 const t=actor(),u='main',s=scope();
 const setScope=(s:ScheduleScope,pack:BookingPack)=>{store.enable(s);store.enablePack(s,pack);};
 setScope(s,kind);await service.configure(t,u,packConfig(kind,depositMinor,notifyWhatsApp));
 let permission:'OPT_IN'|'OPT_OUT'='OPT_IN',recent=true,revoked=false,wrongUnit=false;
 const identities={get:async(tenantId:string,customerId:string):Promise<VerifiedCustomerChannel>=>({
  tenantId,customerId,channel:'WHATSAPP',recipient:PHONE,verifiedAt:'2026-11-01T00:00:00Z',
  provenance:'SIGNED_PROVIDER_WEBHOOK',proofRef:'signed-meta-proof',...(revoked?{revokedAt:'2026-11-22T00:00:00Z'}:{})})};
 const consent={get:async(tenantId:string,unitId:string,customerId:string):Promise<TrustedContactConsent>=>({
  tenantId,unitId:wrongUnit?'foreign':unitId,customerId,channel:'WHATSAPP',recipient:PHONE,
  preference:permission,provenance:'SIGNED_PROVIDER_WEBHOOK',providerEventId:'signed-meta-event',recordedAt:'2026-11-01T00:00:00Z'})};
 const window={hasRecentVerifiedInbound:vi.fn(async()=>recent)};
 const sender={send:vi.fn(async(_input:import('../src/channels/whatsappDelivery').WhatsAppSendInput)=>({externalMessageId:'wamid.test_result',duplicate:false}))};
 let live=true;
 const notice=new PackNoticeService(store,service,customers,identities,consent,window,sender,()=>{if(!live)throw Error('disabled');});
 return {store,service,notice,sender,customers,identities,consent,window,t,u,s,
  now:()=>now,advance:(ms:number)=>{now+=ms;},time:(ms:number)=>{now=ms;},setScope,
  optOut:()=>{permission='OPT_OUT';},optIn:()=>{permission='OPT_IN';},closeWindow:()=>{recent=false;},
  openWindow:()=>{recent=true;},revoke:()=>{revoked=true;},wrongUnit:()=>{wrongUnit=true;},
  disableLive:()=>{live=false;},enableLive:()=>{live=true;}};
}
