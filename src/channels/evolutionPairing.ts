import {randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {Router,type Request} from 'express';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';
import {FeatureEntitlementService} from '../plans/service';
import {FirestoreSubscriptionRepository} from '../plans/firestoreRepository';
import type {TenantContext} from '../types/contracts';
import {channelDocId,channelError,FirestoreWhatsAppConnectionStore} from './whatsappConnections';
import {EvolutionV2Client,GoogleEvolutionVault,evolutionInstance,evolutionTokenEqual,evolutionEventId,
 type EvolutionVault} from './evolutionClient';
import {stageEvolutionAttendance} from './evolutionAttendanceStore';
import {attendanceHash} from './evolutionAttendance';

export type EvolutionStatus='DISABLED'|'NOT_PROVISIONED'|'DISCONNECTED'|'PAIRING'|'CONNECTED';
export type EvolutionOverview={status:EvolutionStatus;connected:boolean;qrCode?:string;expiresInSeconds?:number;commercialEnabled:false};
type Scope={tenantId:string;unitId:string};
type Binding=Scope&{instanceName:string;status:EvolutionStatus;leaseId:string;leaseUntil:number;updatedAt:string;ownerPhone?:string};
export interface EvolutionStore{
 acquire(s:Scope,leaseId:string,requireExclusive?:boolean):Promise<void>;
 finish(s:Scope,leaseId:string,status:EvolutionStatus,ownerPhone?:string):Promise<void>;
 get(s:Scope):Promise<Binding|null>;
 persist(s:Scope,id:string,event:EvolutionInbound):Promise<boolean>;
}
function db(){return getFirestore(ensureFirebaseAdminApp());}
function scopeRef(s:Scope){return db().collection('merchantEvolutionConnections').doc(channelDocId(s.tenantId,s.unitId));}
function assertBinding(s:Scope,b:Binding|undefined):void{
 if(b&&(b.tenantId!==s.tenantId||b.unitId!==s.unitId||b.instanceName!==evolutionInstance(s.tenantId,s.unitId)))
  throw channelError('EVOLUTION_BINDING_MISMATCH');
}
export class FirestoreEvolutionStore implements EvolutionStore{
 async get(s:Scope){const b=(await scopeRef(s).get()).data() as Binding|undefined;assertBinding(s,b);return b??null;}
 async acquire(s:Scope,leaseId:string,requireExclusive=true){
  const ref=scopeRef(s);await db().runTransaction(async tx=>{
   const b=(await tx.get(ref)).data() as Binding|undefined;assertBinding(s,b);
   if(b&&b.leaseUntil>Date.now())throw channelError('EVOLUTION_BUSY','CONFLICT');
   if(requireExclusive){
    const meta=await tx.get(db().collection('merchantWhatsAppConnections').doc(channelDocId(s.tenantId,s.unitId)));
    if(meta.get('status')==='ACTIVE')throw channelError('EVOLUTION_META_ACTIVE_CONFLICT','CONFLICT');
   }
   tx.set(ref,{...s,instanceName:evolutionInstance(s.tenantId,s.unitId),status:'DISCONNECTED',
    leaseId,leaseUntil:Date.now()+120000,updatedAt:new Date().toISOString(),...(b?.ownerPhone?{ownerPhone:b.ownerPhone}:{})} satisfies Binding);
  });
 }
 async finish(s:Scope,leaseId:string,status:EvolutionStatus,ownerPhone?:string){
  const ref=scopeRef(s);await db().runTransaction(async tx=>{
   const b=(await tx.get(ref)).data() as Binding|undefined;assertBinding(s,b);
   if(!b||b.leaseId!==leaseId||b.leaseUntil<=Date.now())throw channelError('EVOLUTION_LEASE_EXPIRED','CONFLICT');
   if(status==='CONNECTED'){
    if(!ownerPhone||!/^55[1-9][0-9]{9,10}$/.test(ownerPhone))throw channelError('EVOLUTION_OWNER_UNVERIFIED');
    const phone=db().collection('evolutionPhoneReservations').doc(attendanceHash(ownerPhone));
    const meta=db().collection('merchantWhatsAppConnections').doc(channelDocId(s.tenantId,s.unitId));
    const [claim,other]=await Promise.all([tx.get(phone),tx.get(meta)]);
    if(claim.exists&&(claim.get('tenantId')!==s.tenantId||claim.get('unitId')!==s.unitId)||
     b.ownerPhone&&b.ownerPhone!==ownerPhone||other.get('status')==='ACTIVE')throw channelError('EVOLUTION_PHONE_OR_CHANNEL_CONFLICT','CONFLICT');
    tx.set(phone,{...s,instanceName:b.instanceName,ownerPhone,verifiedAt:new Date().toISOString()});
   }
   tx.update(ref,{status,leaseId:'',leaseUntil:0,updatedAt:new Date().toISOString(),...(ownerPhone?{ownerPhone}:{})});
  });
 }
 async persist(s:Scope,id:string,event:EvolutionInbound){
  const database=db(),ref=database.collection('evolutionInboundInbox').doc(evolutionEventId(s.tenantId,s.unitId,id));
  const binding=scopeRef(s);
  return database.runTransaction(async tx=>{
   const [prior,row]=await Promise.all([tx.get(ref),tx.get(binding)]);
   const b=row.data() as Binding|undefined;assertBinding(s,b);
   if(!b||!b.ownerPhone||b.ownerPhone===event.sender)throw channelError('EVOLUTION_SESSION_NOT_VERIFIED');
   if(b.status!=='CONNECTED'||b.leaseUntil>Date.now())throw channelError('EVOLUTION_SESSION_BUSY','CONFLICT');
   if(prior.exists){
    if(prior.get('tenantId')!==s.tenantId||prior.get('unitId')!==s.unitId||
     prior.get('externalMessageId')!==id||prior.get('sender')!==event.sender||prior.get('text')!==event.text||prior.get('occurredAt')!==event.occurredAt)throw channelError('EVOLUTION_INBOX_CONFLICT','CONFLICT');
    return false;
   }
   const claim=await tx.get(database.collection('evolutionPhoneReservations').doc(attendanceHash(b.ownerPhone)));
   const meta=await tx.get(database.collection('merchantWhatsAppConnections').doc(channelDocId(s.tenantId,s.unitId)));
   if(!claim.exists||claim.get('tenantId')!==s.tenantId||claim.get('unitId')!==s.unitId||meta.get('status')==='ACTIVE')
    throw channelError('EVOLUTION_PHONE_OR_CHANNEL_CONFLICT');
   if(id!==event.externalMessageId)throw channelError('EVOLUTION_EVENT_SCOPE_MISMATCH');
   await stageEvolutionAttendance(database,tx,s,event,Date.now());
   return true;
  });
 }
}
export interface EvolutionInbound{externalMessageId:string;sender:string;text:string;occurredAt:string;}
function record(value:unknown):Record<string,unknown>|null{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}
const individual=/^([1-9][0-9]{9,14})@s\.whatsapp\.net$/;
export function parseEvolutionInbound(body:unknown,instance:string,now=Date.now()):EvolutionInbound[]{
 const root=record(body);
 if(!root||root.instance!==instance)throw channelError('EVOLUTION_EVENT_SCOPE_MISMATCH');
 if(root.event==='messages.update'||root.event==='MESSAGES_UPDATE')return [];
 if(root.event!=='messages.upsert'&&root.event!=='MESSAGES_UPSERT')throw channelError('EVOLUTION_EVENT_UNSUPPORTED','VALIDATION');
 const rows=Array.isArray(root.data)?root.data:[root.data];
 if(rows.length>50)throw channelError('EVOLUTION_EVENT_LIMIT','VALIDATION');
 const result:EvolutionInbound[]=[];
 for(const raw of rows){
  const row=record(raw),key=record(row?.key),msg=record(row?.message);
  if(!row||!key||!msg||key.fromMe!==false||typeof key.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(key.id))continue;
  const jid=typeof key.remoteJid==='string'?key.remoteJid:'';
  // LID without authoritative telephone mapping, broadcasts and groups fail closed.
  const phone=individual.exec(jid)?.[1];
  if(!phone)continue;
  if(typeof key.remoteJidAlt==='string'&&individual.test(key.remoteJidAlt)&&key.remoteJidAlt!==jid)continue;
  const text=msg.conversation??record(msg.extendedTextMessage)?.text;
  const timestamp=typeof row.messageTimestamp==='number'?row.messageTimestamp:
   typeof row.messageTimestamp==='string'&&/^[0-9]{10}$/.test(row.messageTimestamp)?Number(row.messageTimestamp):NaN;
  if(typeof text!=='string'||!text.trim()||text.length>4096||!Number.isSafeInteger(timestamp)||
   timestamp*1000<now-24*3600000||timestamp*1000>now+300000)continue;
  result.push({externalMessageId:key.id,sender:phone,text:text.trim(),occurredAt:new Date(timestamp*1000).toISOString()});
 }
 return result;
}
type Client=Pick<EvolutionV2Client,'state'|'configureWebhook'|'verifyWebhook'|'qr'|'logout'|'ownerPhone'>;
type Dependencies={
 store:EvolutionStore;vault:EvolutionVault;client:Client;
 authorizeUnit:(s:Scope,requirePlan:boolean)=>Promise<void>;
 metaActive:(s:Scope)=>Promise<boolean>;pairingEnabled:()=>boolean;inboundEnabled:()=>boolean;
 callback:(s:Scope)=>string;
};
function overview(status:EvolutionStatus):EvolutionOverview{return {status,connected:status==='CONNECTED',commercialEnabled:false};}
export class EvolutionPairingService{
 constructor(private readonly deps:Dependencies){}
 private async scope(ctx:TenantContext|undefined,u:string,requirePlan=true):Promise<Scope>{
  if(!ctx?.userId||ctx.role!=='OWNER')throw channelError('EVOLUTION_OWNER_REQUIRED');
  const s={tenantId:ctx.tenantId,unitId:u};channelDocId(s.tenantId,s.unitId);
  await this.deps.authorizeUnit(s,requirePlan);
  return s;
 }
 private async credential(s:Scope){return this.deps.vault.load(s.tenantId,s.unitId);}
 async status(ctx:TenantContext|undefined,u:string):Promise<EvolutionOverview>{
  const s=await this.scope(ctx,u,false);
  if(!this.deps.pairingEnabled())return overview('DISABLED');
  const c=await this.credential(s);if(!c)return overview('NOT_PROVISIONED');
  const binding=await this.deps.store.get(s);
  if(binding&&binding.leaseUntil>Date.now())return overview('PAIRING');
  const state=await this.deps.client.state(c);
  if(state==='open'){
   if(!binding||binding.status!=='CONNECTED')return overview('PAIRING');
   if(await this.deps.client.ownerPhone(c)!==binding.ownerPhone)throw channelError('EVOLUTION_OWNER_UNVERIFIED');
   await this.deps.client.verifyWebhook(c,this.deps.callback(s));
   return overview('CONNECTED');
  }
  return overview(state==='connecting'?'PAIRING':'DISCONNECTED');
 }
 async connect(ctx:TenantContext|undefined,u:string):Promise<EvolutionOverview>{
  const s=await this.scope(ctx,u);
  if(!this.deps.pairingEnabled())return overview('DISABLED');
  if(await this.deps.metaActive(s))throw channelError('EVOLUTION_META_ACTIVE_CONFLICT','CONFLICT');
  const c=await this.credential(s);if(!c)return overview('NOT_PROVISIONED');
  const lease=randomUUID();await this.deps.store.acquire(s,lease);
  let status:EvolutionStatus='DISCONNECTED',ownerPhone:string|undefined;
  try{
   await this.deps.client.configureWebhook(c,this.deps.callback(s));
   const state=await this.deps.client.state(c);
   if(state==='open'){ownerPhone=await this.deps.client.ownerPhone(c);status='CONNECTED';return overview(status);}
   const qrCode=await this.deps.client.qr(c);status='PAIRING';
   return {...overview(status),qrCode,expiresInSeconds:30};
  }finally{await this.deps.store.finish(s,lease,status,ownerPhone);}
 }
 async confirm(ctx:TenantContext|undefined,u:string):Promise<EvolutionOverview>{
  const s=await this.scope(ctx,u);
  if(!this.deps.pairingEnabled())return overview('DISABLED');
  if(await this.deps.metaActive(s))throw channelError('EVOLUTION_META_ACTIVE_CONFLICT','CONFLICT');
  const c=await this.credential(s);if(!c)return overview('NOT_PROVISIONED');
  const lease=randomUUID();await this.deps.store.acquire(s,lease);
  let status:EvolutionStatus='DISCONNECTED',ownerPhone:string|undefined;
  try{
   const state=await this.deps.client.state(c);
   if(state==='open'){
    await this.deps.client.verifyWebhook(c,this.deps.callback(s));ownerPhone=await this.deps.client.ownerPhone(c);status='CONNECTED';
   }else if(state==='connecting')status='PAIRING';
   return overview(status);
  }finally{await this.deps.store.finish(s,lease,status,ownerPhone);}
 }
 async disconnect(ctx:TenantContext|undefined,u:string):Promise<EvolutionOverview>{
  const s=await this.scope(ctx,u,false);
  if(!this.deps.pairingEnabled())return overview('DISABLED');
  const c=await this.credential(s);if(!c)return overview('NOT_PROVISIONED');
  const lease=randomUUID();await this.deps.store.acquire(s,lease,false);
  let status:EvolutionStatus='DISCONNECTED';
  try{if(await this.deps.client.state(c)!=='close')await this.deps.client.logout(c);return overview(status);}
  finally{await this.deps.store.finish(s,lease,status);}
 }
 async inbound(t:string,u:string,auth:unknown,body:unknown):Promise<{accepted:number;duplicates:number}>{
  const s={tenantId:t,unitId:u};channelDocId(t,u);
  if(!this.deps.pairingEnabled()||!this.deps.inboundEnabled()||typeof auth!=='string'||!/^[A-Za-z0-9_=-]{32,256}$/.test(auth))
   throw channelError('EVOLUTION_INBOUND_DISABLED');
  const existing=await this.deps.store.get(s);
  if(!existing)throw channelError('EVOLUTION_SESSION_NOT_VERIFIED');
  const c=await this.credential(s);
  if(!c||!evolutionTokenEqual(auth,c.webhookToken))throw channelError('EVOLUTION_WEBHOOK_UNAUTHORIZED');
  if(existing.status!=='CONNECTED'||existing.leaseUntil>Date.now())throw channelError('EVOLUTION_SESSION_BUSY','CONFLICT');
  await this.deps.authorizeUnit(s,true);
  if(await this.deps.metaActive(s))throw channelError('EVOLUTION_META_ACTIVE_CONFLICT');
  const b=await this.deps.store.get(s);
  if(!b||b.status!=='CONNECTED'||b.leaseUntil>Date.now()||await this.deps.client.state(c)!=='open')
   throw channelError('EVOLUTION_SESSION_BUSY','CONFLICT');
  await this.deps.client.verifyWebhook(c,this.deps.callback(s));
  if(!b.ownerPhone||await this.deps.client.ownerPhone(c)!==b.ownerPhone)throw channelError('EVOLUTION_OWNER_UNVERIFIED');
  const events=parseEvolutionInbound(body,c.instanceName);
  let accepted=0,duplicates=0;
  for(const e of events){if(await this.deps.store.persist(s,e.externalMessageId,e))accepted++;else duplicates++;}
  return {accepted,duplicates};
 }
}
function service(){
 const profiles=new FirestoreBusinessProfileRepository(),plans=new FeatureEntitlementService(new FirestoreSubscriptionRepository());
 const meta=new FirestoreWhatsAppConnectionStore();
 return new EvolutionPairingService({
  store:new FirestoreEvolutionStore(),vault:new GoogleEvolutionVault(),
  client:new EvolutionV2Client(process.env.EVOLUTION_API_ORIGIN??''),
  async authorizeUnit(s,requirePlan){
   const p=await profiles.effective(s.tenantId,s.unitId,new Date().toISOString());
   if(!p)throw channelError('EVOLUTION_UNIT_NOT_CONFIGURED');
   if(requirePlan&&!await plans.canUse(s.tenantId,'AI_CHAT'))throw channelError('EVOLUTION_PLAN_REQUIRED');
  },
  async metaActive(s){return (await meta.get(s.tenantId,s.unitId))?.status==='ACTIVE';},
  pairingEnabled:()=>process.env.EVOLUTION_PAIRING_ENABLED==='true',
  inboundEnabled:()=>process.env.EVOLUTION_INBOUND_ENABLED==='true',
  callback:s=>{
   if(process.env.PUBLIC_APP_URL!=='https://app.atendevendeia.com.br')
    throw channelError('EVOLUTION_CALLBACK_ORIGIN_INVALID');
   return process.env.PUBLIC_APP_URL+'/api/channels/webhooks/evolution/'+s.tenantId+'/'+s.unitId;
  },
 });
}
export function createEvolutionRouter(s=service()):Router{
 const r=Router();r.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 r.get('/units/:unitId',async(req,res,next)=>{try{res.json({ok:true,data:await s.status(req.tenantContext,req.params.unitId)});}catch(e){next(e);}});
 r.post('/units/:unitId/connect',async(req,res,next)=>{try{res.json({ok:true,data:await s.connect(req.tenantContext,req.params.unitId)});}catch(e){next(e);}});
 r.post('/units/:unitId/confirm',async(req,res,next)=>{try{res.json({ok:true,data:await s.confirm(req.tenantContext,req.params.unitId)});}catch(e){next(e);}});
 r.post('/units/:unitId/disconnect',async(req,res,next)=>{try{res.json({ok:true,data:await s.disconnect(req.tenantContext,req.params.unitId)});}catch(e){next(e);}});
 return r;
}
export function createEvolutionWebhookRouter(s=service()):Router{
 const r=Router();r.post('/:tenantId/:unitId',async(req:Request,res)=>{
  try{res.status(200).json({ok:true,...await s.inbound(req.params.tenantId,req.params.unitId,req.headers['x-av-evolution-auth'],req.body)});}
  catch(e){const code=(e as {category?:string})?.category;
   res.status(code==='FORBIDDEN'||code==='VALIDATION'?401:503).json({ok:false});}
 });return r;
}
