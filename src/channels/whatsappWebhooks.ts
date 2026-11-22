import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import type {Request,Response,Router} from 'express';
import {Router as ExpressRouter} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import {WhatsAppAdapter} from './whatsappAdapter';
import {ChannelService} from './service';
import type {NormalizedInboundMessage} from './contracts';
import {FirestoreWhatsAppConnectionStore,channelError,CHANNEL_UNIT,CHANNEL_TENANT,
 type WhatsAppConnectionStore,type WhatsAppConnection} from './whatsappConnections';
import {createWhatsAppVault,type WhatsAppCredentialsVault} from './whatsappVault';

export function verifyMetaSignature(raw:Buffer,signature:unknown,appSecret:string):boolean{
 if(!raw.length||raw.length>256*1024||typeof signature!=='string'||
  !/^sha256=[a-f0-9]{64}$/i.test(signature)||appSecret.length<16)return false;
 const expected=createHmac('sha256',appSecret).update(raw).digest();
 const actual=Buffer.from(signature.slice(7),'hex');
 return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function plain(v:unknown):v is Record<string,unknown>{
 return !!v&&typeof v==='object'&&!Array.isArray(v);
}
export function verifyWhatsAppAccountPayload(value:unknown,conn:WhatsAppConnection):boolean{
 if(!plain(value)||value.object!=='whatsapp_business_account'||!Array.isArray(value.entry)||
  !value.entry.length||value.entry.length>10)return false;
 let changes=0;
 for(const e of value.entry){
  if(!plain(e)||e.id!==conn.wabaId||!Array.isArray(e.changes)||
   !e.changes.length||e.changes.length>20)return false;
  for(const change of e.changes){
   if(!plain(change)||change.field!=='messages'||!plain(change.value)||
    change.value.messaging_product!=='whatsapp'||!plain(change.value.metadata)||
    change.value.metadata.phone_number_id!==conn.phoneNumberId)return false;
   if(Array.isArray(change.value.messages)&&change.value.messages.length>50)return false;
   changes++;
  }
 }
 return changes>0&&changes<=100;
}
export interface WhatsAppInbox {
 persist(conn:WhatsAppConnection,message:NormalizedInboundMessage):Promise<boolean>;
}
function db(){
 if(!getApps().length)initializeApp(process.env.FIREBASE_PROJECT_ID?{projectId:process.env.FIREBASE_PROJECT_ID}:undefined);
 return getFirestore();
}
export function whatsappMessageKey(conn:WhatsAppConnection,message:NormalizedInboundMessage):string{
 return createHash('sha256').update(JSON.stringify([
  conn.tenantId,conn.unitId,conn.phoneNumberId,message.externalMessageId,
 ])).digest('hex');
}
export class FirestoreWhatsAppInbox implements WhatsAppInbox{
 async persist(conn:WhatsAppConnection,message:NormalizedInboundMessage){
  if(message.tenantId!==conn.tenantId||message.externalAccountRef!==conn.phoneNumberId||
   !message.externalMessageId||message.externalMessageId.length>220)
   throw channelError('CHANNEL_INBOX_ACCOUNT_MISMATCH');
  const ref=db().collection('whatsappInboundInbox').doc(whatsappMessageKey(conn,message));
  try{
   await ref.create({tenantId:conn.tenantId,unitId:conn.unitId,channel:'WHATSAPP',
    phoneNumberId:conn.phoneNumberId,
    event:Object.fromEntries(Object.entries(message).filter(([,value])=>value!==undefined)),state:'RECEIVED',
    receivedAt:new Date().toISOString()});
   return true;
  }catch(error){
   if((error as {code?:unknown}).code===6)return false;
   throw error;
  }
 }
}
function forbidden(res:Response){res.status(401).json({ok:false});}
export function createWhatsAppWebhookRouter(deps:{
 connections:WhatsAppConnectionStore;vault:WhatsAppCredentialsVault;inbox:WhatsAppInbox;
}={connections:new FirestoreWhatsAppConnectionStore(),vault:createWhatsAppVault(),inbox:new FirestoreWhatsAppInbox()}):Router{
 const router=ExpressRouter();
 const getConnection=async(req:Request)=>{
  const t=req.params.tenantId,u=req.params.unitId;
  if(!CHANNEL_TENANT.test(t)||!CHANNEL_UNIT.test(u))throw channelError('CHANNEL_SCOPE_INVALID');
  const conn=await deps.connections.get(t,u);
  if(!conn||!conn.credentialRef||conn.status==='DISABLED')throw channelError('CHANNEL_NOT_AVAILABLE');
  return conn;
 };
 router.get('/:tenantId/:unitId',async(req,res)=>{
  try{
   const conn=await getConnection(req);
   // Registration handshake may take place while pending; never enables traffic.
   const mode=req.query['hub.mode'],token=req.query['hub.verify_token'],challenge=req.query['hub.challenge'];
   if(mode!=='subscribe'||typeof token!=='string'||typeof challenge!=='string'||
    !/^[0-9]{1,30}$/.test(challenge))return forbidden(res);
   const secrets=await deps.vault.load(conn);
   const left=Buffer.from(token),right=Buffer.from(secrets.verifyToken);
   if(left.length!==right.length||!timingSafeEqual(left,right))return forbidden(res);
   res.type('text/plain').status(200).send(challenge);
  }catch{return forbidden(res);}
 });
 router.post('/:tenantId/:unitId',async(req,res)=>{
  try{
   const conn=await getConnection(req);
   if(conn.status!=='ACTIVE')return forbidden(res);
   const raw=(req as Request&{whatsappRawBody?:Buffer}).whatsappRawBody;
   if(!raw||!Buffer.isBuffer(raw))return forbidden(res);
   const secrets=await deps.vault.load(conn);
   if(!verifyMetaSignature(raw,req.headers['x-hub-signature-256'],secrets.appSecret)||
    !verifyWhatsAppAccountPayload(req.body,conn))return forbidden(res);
   const adapter=new WhatsAppAdapter({send:async()=>{throw new Error('Webhook-only transport');}},
    {verify:async({rawBody,signature})=>
     verifyMetaSignature(Buffer.from(rawBody,'utf8'),signature,secrets.appSecret)});
   const service=new ChannelService([adapter]);
   const envelope={tenantId:conn.tenantId,headers:{
    'x-hub-signature-256':typeof req.headers['x-hub-signature-256']==='string'
     ?req.headers['x-hub-signature-256']:undefined},
    rawBody:raw.toString('utf8'),payload:req.body};
   const received=await service.receive('WHATSAPP',envelope);
   if(!received.ok||!received.data)return forbidden(res);
   let accepted=0,duplicates=0;
   for(const message of received.data){
    if(message.externalAccountRef!==conn.phoneNumberId)return forbidden(res);
    if(await deps.inbox.persist(conn,message))accepted++;else duplicates++;
   }
   // Status callbacks may have no inbound messages. Never create a fake sale or AI reply.
   res.status(200).json({ok:true,accepted,duplicates});
  }catch(error){
   if(error instanceof ApplicationError&&
    (error.category==='FORBIDDEN'||error.category==='VALIDATION'))return forbidden(res);
   res.status(503).json({ok:false});
  }
 });
 return router;
}
