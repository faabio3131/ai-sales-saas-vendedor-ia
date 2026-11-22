import {createHash} from 'node:crypto';
import {requirePilotLiveFeature} from '../operations/pilotFlags';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {channelError,CHANNEL_TENANT,CHANNEL_UNIT,type WhatsAppConnectionStore,
 FirestoreWhatsAppConnectionStore} from './whatsappConnections';
import {createWhatsAppVault,type WhatsAppCredentialsVault} from './whatsappVault';
import type {WhatsAppSecrets} from './whatsappVault';

const E164=/^[1-9][0-9]{9,14}$/;
const DEDUPE=/^[A-Za-z0-9_-]{8,128}$/;
export interface WhatsAppSendInput{
 tenantId:string;unitId:string;recipient:string;text:string;
 idempotencyKey:string;
 /** Trusted upstream policy must attest valid customer-service window/consent. */
 authorizedCustomerServiceWindow:boolean;
}
export interface WhatsAppSendRecord{
 tenantId:string;unitId:string;idempotencyKey:string;payloadHash:string;
 status:'RESERVED'|'SENT'|'UNKNOWN';externalMessageId?:string;
 createdAt:string;updatedAt:string;
}
export interface WhatsAppOutbox{
 reserve(record:WhatsAppSendRecord):Promise<WhatsAppSendRecord>;
 settle(record:WhatsAppSendRecord):Promise<void>;
}
export interface WhatsAppCustomerServicePolicy{
 hasRecentVerifiedInbound(tenantId:string,unitId:string,recipient:string):Promise<boolean>;
}
/** A real signed, stored inbound message is required; owner-provided booleans alone cannot authorize unsolicited messages. */
export class FirestoreWhatsAppCustomerServicePolicy implements WhatsAppCustomerServicePolicy{
 async hasRecentVerifiedInbound(t:string,u:string,recipient:string){
  const now=Date.now(),cutoff=new Date(now-24*60*60*1000).toISOString();
  const rows=await db().collection('whatsappInboundInbox')
   .where('tenantId','==',t).where('unitId','==',u)
   .where('event.sender','==',recipient).orderBy('receivedAt','desc').limit(10).get();
  return rows.docs.some(d=>{
   const event=d.data() as {receivedAt?:string;event?:{occurredAt?:string}};
   const received=Date.parse(event.receivedAt??''),occurred=Date.parse(event.event?.occurredAt??'');
   return Number.isFinite(received)&&received>=Date.parse(cutoff)&&
    Number.isFinite(occurred)&&occurred>=Date.parse(cutoff)&&occurred<=now+5*60*1000;
  });
 }
}
function db(){
 if(!getApps().length)initializeApp(process.env.FIREBASE_PROJECT_ID?{projectId:process.env.FIREBASE_PROJECT_ID}:undefined);
 return getFirestore();
}
function key(r:WhatsAppSendRecord){
 return createHash('sha256').update(JSON.stringify([r.tenantId,r.unitId,r.idempotencyKey])).digest('hex');
}
export class FirestoreWhatsAppOutbox implements WhatsAppOutbox{
 async reserve(record:WhatsAppSendRecord){
  const ref=db().collection('whatsappOutboundOutbox').doc(key(record));
  return db().runTransaction(async tx=>{
   const snapshot=await tx.get(ref),prior=snapshot.data() as WhatsAppSendRecord|undefined;
   if(prior){
    if(prior.tenantId!==record.tenantId||prior.unitId!==record.unitId||
      prior.payloadHash!==record.payloadHash)
     throw channelError('WHATSAPP_IDEMPOTENCY_CONFLICT','CONFLICT');
    return prior;
   }
   tx.create(ref,record);return record;
  });
 }
 async settle(record:WhatsAppSendRecord){
  const ref=db().collection('whatsappOutboundOutbox').doc(key(record));
  await db().runTransaction(async tx=>{
   const snap=await tx.get(ref),prior=snap.data() as WhatsAppSendRecord|undefined;
   if(!prior||prior.payloadHash!==record.payloadHash||prior.status!=='RESERVED')
    throw channelError('WHATSAPP_OUTBOX_STATE_CONFLICT','CONFLICT');
   if(record.status!=='SENT'&&record.status!=='UNKNOWN')throw channelError('WHATSAPP_OUTBOX_STATE_INVALID');
   tx.set(ref,record);
  });
 }
}
export interface MetaGraphSender{
 send(phoneNumberId:string,recipient:string,text:string,
  credentials:WhatsAppSecrets):Promise<string>;
}
export class OfficialMetaGraphSender implements MetaGraphSender{
 constructor(private readonly fetchImpl:typeof fetch=fetch,
  private readonly graphVersion=process.env.WHATSAPP_GRAPH_VERSION??'v26.0'){}
 async send(phoneNumberId:string,recipient:string,text:string,secrets:WhatsAppSecrets){
  if(!/^v[0-9]{2}\.[0-9]{1,2}$/.test(this.graphVersion)||
   !/^[1-9][0-9]{5,30}$/.test(phoneNumberId)||secrets.phoneNumberId!==phoneNumberId)
   throw channelError('WHATSAPP_GRAPH_CONFIG_INVALID','VALIDATION');
  let response:Response;
  try{
   response=await this.fetchImpl('https://graph.facebook.com/'+this.graphVersion+'/'+phoneNumberId+'/messages',{
    method:'POST',headers:{Authorization:'Bearer '+secrets.accessToken,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',
     to:recipient,type:'text',text:{preview_url:false,body:text}}),signal:AbortSignal.timeout(12000),
   });
  }catch{throw channelError('WHATSAPP_PROVIDER_UNAVAILABLE','PROVIDER');}
  if(!response.ok)throw channelError('WHATSAPP_PROVIDER_REJECTED','PROVIDER');
  let value:unknown;
  try{value=await response.json();}catch{throw channelError('WHATSAPP_RESPONSE_INVALID','PROVIDER');}
  const root=value as {messages?:Array<{id?:unknown}>};
  const id=root?.messages?.[0]?.id;
  if(typeof id!=='string'||!/^wamid\.[a-zA-Z0-9._=-]{4,220}$/.test(id))
   throw channelError('WHATSAPP_RESPONSE_INVALID','PROVIDER');
  return id;
 }
}
/** Worker-facing only. Never exposed as an arbitrary send-message HTTP endpoint. */
export class WhatsAppDeliveryService{
 constructor(private readonly connections:WhatsAppConnectionStore,
  private readonly vault:WhatsAppCredentialsVault,
  private readonly outbox:WhatsAppOutbox,
  private readonly graph:MetaGraphSender,
  private readonly policy:WhatsAppCustomerServicePolicy,
  private readonly clock:()=>Date=()=>new Date()){}
 async send(input:WhatsAppSendInput):Promise<{externalMessageId:string;duplicate:boolean}>{
  requirePilotLiveFeature('WHATSAPP_OUTBOUND',input.tenantId,input.unitId);
  if(!CHANNEL_TENANT.test(input.tenantId)||!CHANNEL_UNIT.test(input.unitId)||
   !E164.test(input.recipient)||!DEDUPE.test(input.idempotencyKey)||
   typeof input.text!=='string'||!input.text.trim()||input.text.length>4096)
   throw channelError('WHATSAPP_SEND_INPUT_INVALID','VALIDATION');
  if(input.authorizedCustomerServiceWindow!==true||
   !(await this.policy.hasRecentVerifiedInbound(input.tenantId,input.unitId,input.recipient)))
   throw channelError('WHATSAPP_CUSTOMER_CONSENT_REQUIRED');
  const conn=await this.connections.get(input.tenantId,input.unitId);
  if(!conn||conn.status!=='ACTIVE'||!conn.credentialRef)
   throw channelError('WHATSAPP_CONNECTION_NOT_ACTIVE');
  const hash=createHash('sha256').update(JSON.stringify([
   conn.tenantId,conn.unitId,conn.phoneNumberId,input.recipient,input.text,
  ])).digest('hex');
  const now=this.clock().toISOString();
  const record:WhatsAppSendRecord={tenantId:conn.tenantId,unitId:conn.unitId,
   idempotencyKey:input.idempotencyKey,payloadHash:hash,status:'RESERVED',
   createdAt:now,updatedAt:now};
  const reserved=await this.outbox.reserve(record);
  if(reserved.status==='SENT'&&reserved.externalMessageId)
   return {externalMessageId:reserved.externalMessageId,duplicate:true};
  // An in-flight or uncertain send MUST NOT be sent twice.
  if(reserved!==record&&reserved.status!=='SENT')
   throw channelError('WHATSAPP_DELIVERY_UNCERTAIN','CONFLICT');
  try{
   const secrets=await this.vault.load(conn);
   const externalMessageId=await this.graph.send(conn.phoneNumberId,input.recipient,input.text,secrets);
   await this.outbox.settle({...record,status:'SENT',externalMessageId,updatedAt:this.clock().toISOString()});
   return {externalMessageId,duplicate:false};
  }catch{
   try{await this.outbox.settle({...record,status:'UNKNOWN',updatedAt:this.clock().toISOString()});}
   catch{/* Preserve original unknown state for manual reconciliation. */}
   throw channelError('WHATSAPP_DELIVERY_UNCERTAIN','PROVIDER');
  }
 }
}
export function createWhatsAppDeliveryService(){
 return new WhatsAppDeliveryService(new FirestoreWhatsAppConnectionStore(),
  createWhatsAppVault(),new FirestoreWhatsAppOutbox(),new OfficialMetaGraphSender(),
  new FirestoreWhatsAppCustomerServicePolicy());
}
