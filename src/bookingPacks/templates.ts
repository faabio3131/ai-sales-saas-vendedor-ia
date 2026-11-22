import {createHash} from 'node:crypto';
import type {Booking,NoticeKind,ScheduleScope} from '../scheduling/model';
import type {WhatsAppConnectionStore} from '../channels/whatsappConnections';
import {CHANNEL_TENANT,CHANNEL_UNIT} from '../channels/whatsappConnections';
import type {WhatsAppCredentialsVault} from '../channels/whatsappVault';
import type {WhatsAppOutbox,WhatsAppSendRecord} from '../channels/whatsappDelivery';
import {requirePilotLiveFeature} from '../operations/pilotFlags';
import {reject} from '../scheduling/rules';

// Code-owned privacy-safe utility copy, not a free-text/mass marketing API.
// Only the time parameter varies; no clinical/commercial service name or PII.
export function bookingTemplateBody(kind:NoticeKind){
 const labels:Record<NoticeKind,string>={
  CONFIRMATION:'Seu agendamento foi confirmado para {{1}}.',
  RESCHEDULE:'Seu agendamento foi alterado para {{1}}.',
  CANCELLATION:'Seu agendamento de {{1}} foi cancelado.',
  REMINDER:'Lembrete: seu agendamento está marcado para {{1}}.',
 };
 return labels[kind]+' Para informações, fale com o estabelecimento.';
}
export function appointmentParameter(b:Booking){
 return new Intl.DateTimeFormat('pt-BR',{timeZone:b.timezone,dateStyle:'short',timeStyle:'short'}).format(b.startMs)+' ('+b.timezone+')';
}
export interface TemplateInput extends ScheduleScope{
 recipient:string;name:string;kind:NoticeKind;parameter:string;idempotencyKey:string;
}
export interface PackUtilityTemplatePort{
 prepare(input:TemplateInput):Promise<()=>Promise<{externalMessageId:string;duplicate:boolean}>>;
}
export class MetaBookingTemplateService implements PackUtilityTemplatePort{
 constructor(private readonly connections:WhatsAppConnectionStore,
  private readonly vault:WhatsAppCredentialsVault,private readonly outbox:WhatsAppOutbox,
  private readonly fetchImpl:typeof fetch=fetch,
  private readonly graphVersion=process.env.WHATSAPP_GRAPH_VERSION??'v26.0',
  private readonly clock:()=>Date=()=>new Date()){}
 async prepare(input:TemplateInput){
  requirePilotLiveFeature('WHATSAPP_OUTBOUND',input.tenantId,input.unitId);
  if(process.env.NODE_ENV!=='test'&&process.env.ATENDEVENDE_BOOKING_WHATSAPP_LIVE_ENABLED!=='true')
   return reject('PACK_WHATSAPP_LIVE_DISABLED','FORBIDDEN');
  if(!CHANNEL_TENANT.test(input.tenantId)||!CHANNEL_UNIT.test(input.unitId)||
     !/^[1-9]\d{9,14}$/.test(input.recipient)||!/^[a-z0-9_]{1,128}$/.test(input.name)||
     !/^notice_[a-f0-9]{48}$/.test(input.idempotencyKey)||
     !/^\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2} \([A-Za-z0-9_+/-]{1,80}\)$/.test(input.parameter)||
     !/^[v]([0-9]{2})\.[0-9]{1,2}$/.test(this.graphVersion))
   return reject('PACK_TEMPLATE_INPUT_INVALID');
  const conn=await this.connections.get(input.tenantId,input.unitId);
  if(!conn||conn.tenantId!==input.tenantId||conn.unitId!==input.unitId||conn.status!=='ACTIVE'||
     !conn.credentialRef||!/^[1-9]\d{5,30}$/.test(conn.phoneNumberId)||!/^[1-9]\d{5,30}$/.test(conn.wabaId))
   return reject('PACK_TEMPLATE_CONNECTION_INVALID','FORBIDDEN');
  const secrets=await this.vault.load(conn);
  if(secrets.tenantId!==input.tenantId||secrets.unitId!==input.unitId||secrets.wabaId!==conn.wabaId||secrets.phoneNumberId!==conn.phoneNumberId)
   return reject('PACK_TEMPLATE_VAULT_MISMATCH','FORBIDDEN');
  const query=new URLSearchParams({name:input.name,fields:'name,status,category,language,components,parameter_format',limit:'100'});
  const response=await this.fetchImpl('https://graph.facebook.com/'+this.graphVersion+'/'+conn.wabaId+'/message_templates?'+query,{
   headers:{Authorization:'Bearer '+secrets.accessToken},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return reject('PACK_TEMPLATE_VERIFICATION_FAILED','PROVIDER');
  const data=await response.json() as {data?:Array<{name?:string;status?:string;category?:string;language?:string;parameter_format?:string;components?:Array<{type?:string;text?:string}>}>};
  if(!Array.isArray(data.data))return reject('PACK_TEMPLATE_VERIFICATION_FAILED','PROVIDER');
  const matches=data.data.filter(t=>t.name===input.name&&t.language==='pt_BR');
  const t=matches[0],body=bookingTemplateBody(input.kind);
  if(matches.length!==1||!t||t.status!=='APPROVED'||t.category!=='UTILITY'||
     (t.parameter_format!==undefined&&t.parameter_format!=='POSITIONAL')||
     !Array.isArray(t.components)||t.components.length!==1||t.components[0].type!=='BODY'||t.components[0].text!==body)
   return reject('PACK_TEMPLATE_NOT_APPROVED_OR_CONTENT_MISMATCH','FORBIDDEN');
  // No provider side effect occurs during preflight. Closure is passed only to
  // PackNoticeService after current booking and signed consent are rechecked.
  return async()=>{
   requirePilotLiveFeature('WHATSAPP_OUTBOUND',input.tenantId,input.unitId);
   if(process.env.NODE_ENV!=='test'&&process.env.ATENDEVENDE_BOOKING_WHATSAPP_LIVE_ENABLED!=='true')
    return reject('PACK_WHATSAPP_LIVE_DISABLED','FORBIDDEN');
   const payloadHash=createHash('sha256').update(JSON.stringify([input.tenantId,input.unitId,conn.phoneNumberId,
    input.recipient,input.name,'pt_BR',body,input.parameter])).digest('hex');
   const now=this.clock().toISOString();
   const record:WhatsAppSendRecord={tenantId:input.tenantId,unitId:input.unitId,idempotencyKey:input.idempotencyKey,
    payloadHash,status:'RESERVED',createdAt:now,updatedAt:now};
   const reservation=await this.outbox.reserve(record);
   if(reservation.status==='SENT'&&reservation.externalMessageId)return {externalMessageId:reservation.externalMessageId,duplicate:true};
   if(reservation!==record)return reject('PACK_TEMPLATE_SEND_UNCERTAIN','CONFLICT');
   try{
    const r=await this.fetchImpl('https://graph.facebook.com/'+this.graphVersion+'/'+conn.phoneNumberId+'/messages',{
     method:'POST',headers:{Authorization:'Bearer '+secrets.accessToken,'content-type':'application/json'},
     body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:input.recipient,
      type:'template',template:{name:input.name,language:{code:'pt_BR'},components:[{type:'body',
       parameters:[{type:'text',text:input.parameter}]}]}}),signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error('provider rejected');
    const value=await r.json() as {messages?:{id?:string}[]};
    const externalMessageId=value.messages?.[0]?.id;
    if(!externalMessageId||!/^wamid\.[A-Za-z0-9._=-]{4,220}$/.test(externalMessageId))throw Error('provider proof invalid');
    await this.outbox.settle({...record,status:'SENT',externalMessageId,updatedAt:this.clock().toISOString()});
    return {externalMessageId,duplicate:false};
   }catch{
    try{await this.outbox.settle({...record,status:'UNKNOWN',updatedAt:this.clock().toISOString()});}catch{/* uncertain remains reserved */}
    return reject('PACK_TEMPLATE_SEND_UNCERTAIN','PROVIDER');
   }
  };
 }
}
