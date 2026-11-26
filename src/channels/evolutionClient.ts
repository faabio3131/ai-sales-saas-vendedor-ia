import {createHash,timingSafeEqual} from 'node:crypto';
import {applicationDefault} from 'firebase-admin/app';
import {channelDocId,channelError} from './whatsappConnections';

export type EvolutionState='open'|'close'|'connecting';
export interface EvolutionCredential {
 tenantId:string;unitId:string;instanceName:string;apiKey:string;webhookToken:string;expectedOwnerPhone:string;
}
export interface EvolutionVault {load(t:string,u:string):Promise<EvolutionCredential|null>;}
const validSecret=(s:unknown):s is string=>typeof s==='string'&&/^[A-Za-z0-9_=-]{32,256}$/.test(s);
export function evolutionInstance(t:string,u:string):string{return 'avc-'+channelDocId(t,u).slice(0,40);}
export function evolutionSecretId(t:string,u:string):string{return 'avevo-'+channelDocId(t,u).slice(0,48);}
export function evolutionTokenEqual(actual:unknown,expected:string):boolean {
 if(typeof actual!=='string'||actual.length>256)return false;
 const a=Buffer.from(actual),b=Buffer.from(expected);
 return a.length===b.length&&timingSafeEqual(a,b);
}
function object(x:unknown):Record<string,unknown>{
 if(!x||typeof x!=='object'||Array.isArray(x))throw channelError('EVOLUTION_RESPONSE_INVALID','PROVIDER');
 return x as Record<string,unknown>;
}
export function validateEvolutionCredential(t:string,u:string,raw:unknown):EvolutionCredential {
 const x=object(raw);
 if(x.tenantId!==t||x.unitId!==u||x.instanceName!==evolutionInstance(t,u)||
  !validSecret(x.apiKey)||!validSecret(x.webhookToken)||x.apiKey===x.webhookToken||
  typeof x.expectedOwnerPhone!=='string'||!/^55[1-9][0-9]{9,10}$/.test(x.expectedOwnerPhone))
  throw channelError('EVOLUTION_VAULT_BINDING_MISMATCH');
 return {tenantId:t,unitId:u,instanceName:x.instanceName as string,apiKey:x.apiKey,webhookToken:x.webhookToken,expectedOwnerPhone:x.expectedOwnerPhone};
}
/** Per-unit credential. No global administrator key in the app. */
export class GoogleEvolutionVault implements EvolutionVault{
 constructor(private readonly fetchImpl:typeof fetch=fetch,
  private readonly accessToken:()=>Promise<string>=async()=>(await applicationDefault().getAccessToken()).access_token){}
 async load(t:string,u:string):Promise<EvolutionCredential|null>{
  const project=process.env.FIREBASE_PROJECT_ID;
  if(!project||!/^[a-z][a-z0-9-]{4,62}$/.test(project))throw channelError('EVOLUTION_PROJECT_INVALID');
  const ref='projects/'+project+'/secrets/'+evolutionSecretId(t,u)+'/versions/latest';
  let response:Response;
  try{
   const token=await this.accessToken();
   response=await this.fetchImpl('https://secretmanager.googleapis.com/v1/'+ref+':access',{
    headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(8000)});
  }catch{throw channelError('EVOLUTION_VAULT_UNAVAILABLE','PROVIDER');}
  if(response.status===404)return null;
  if(!response.ok)throw channelError('EVOLUTION_VAULT_DENIED','PROVIDER');
  let raw:unknown;
  try{
   const data=object(await response.json()),payload=object(data.payload);
   if(typeof payload.data!=='string'||payload.data.length>20000)throw Error('invalid payload');
   const decoded=Buffer.from(payload.data,'base64');
   if(decoded.toString('base64')!==payload.data)throw Error('invalid encoding');
   raw=JSON.parse(decoded.toString('utf8'));
   if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid credential shape');
  }catch{throw channelError('EVOLUTION_VAULT_INVALID');}
  return validateEvolutionCredential(t,u,raw);
 }
}
export function evolutionOrigin(value:string|undefined):string{
 // Fixed operator-managed origin, never supplied by the merchant.
 let url:URL;
 try{url=new URL(value??'');}catch{throw channelError('EVOLUTION_ORIGIN_INVALID');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||
  url.pathname!=='/'||url.search||url.hash||
  url.hostname!=='evolution-app.atendevendeia.com.br')
  throw channelError('EVOLUTION_ORIGIN_INVALID');
 return url.origin;
}
export function evolutionQr(value:unknown):string{
 const root=object(value);
 const nested=root.qrcode&&typeof root.qrcode==='object'?object(root.qrcode):{};
 const raw=root.base64??nested.base64;
 if(typeof raw!=='string')throw channelError('EVOLUTION_QR_UNAVAILABLE','PROVIDER');
 const encoded=raw.replace(/^data:image\/png;base64,/,'');
 if(encoded.length>220000||!encoded||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
  throw channelError('EVOLUTION_QR_INVALID','PROVIDER');
 const png=Buffer.from(encoded,'base64');
 if(png.length<24||png.length>160000||png.toString('base64')!==encoded||
  !png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
  png.toString('ascii',12,16)!=='IHDR'||png.readUInt32BE(16)>2048||png.readUInt32BE(20)>2048||
  png.readUInt32BE(16)===0||png.readUInt32BE(20)===0)
  throw channelError('EVOLUTION_QR_INVALID','PROVIDER');
 return 'data:image/png;base64,'+encoded;
}
export class EvolutionV2Client{
 constructor(private readonly origin:string,private readonly fetchImpl:typeof fetch=fetch){}
 private async callRaw(c:EvolutionCredential,method:string,route:string,body?:object,fetchInstance=false):Promise<unknown>{
  if(c.instanceName!==evolutionInstance(c.tenantId,c.unitId))throw channelError('EVOLUTION_SCOPE_MISMATCH');
  const url=evolutionOrigin(this.origin)+route+(fetchInstance?'?instanceName='+encodeURIComponent(c.instanceName):'/'+c.instanceName);
  let response:Response;
  try{response=await this.fetchImpl(url,{method,headers:{apikey:c.apiKey,'Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(8000)});}
  catch{throw channelError('EVOLUTION_UNREACHABLE','PROVIDER');}
  if(!response.ok)throw channelError(response.status===404?'EVOLUTION_INSTANCE_NOT_PROVISIONED':'EVOLUTION_PROVIDER_REJECTED','PROVIDER');
  if(!response.body)throw channelError('EVOLUTION_RESPONSE_INVALID','PROVIDER');
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const item=await reader.read();if(item.done)break;
   size+=item.value.byteLength;if(size>256000){await reader.cancel();throw channelError('EVOLUTION_RESPONSE_LIMIT','PROVIDER');}
   chunks.push(item.value);}}
  finally{reader.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}
  catch{throw channelError('EVOLUTION_RESPONSE_INVALID','PROVIDER');}
 }
 private async call(c:EvolutionCredential,method:string,route:string,body?:object){
  return object(await this.callRaw(c,method,route,body));
 }
 async ownerPhone(c:EvolutionCredential):Promise<string>{
  const rows=await this.callRaw(c,'GET','/instance/fetchInstances',undefined,true);
  if(!Array.isArray(rows)||rows.length!==1)throw channelError('EVOLUTION_OWNER_UNVERIFIED','PROVIDER');
  const row=object(rows[0]);
  const phone=typeof row.ownerJid==='string'?/^([1-9][0-9]{9,14})(?::[0-9]+)?@s\.whatsapp\.net$/.exec(row.ownerJid)?.[1]:undefined;
  if(row.name!==c.instanceName||row.connectionStatus!=='open'||!phone||phone!==c.expectedOwnerPhone)
   throw channelError('EVOLUTION_OWNER_UNVERIFIED','PROVIDER');
  return phone;
 }
 async state(c:EvolutionCredential):Promise<EvolutionState>{
  const root=await this.call(c,'GET','/instance/connectionState'),i=object(root.instance);
  if(i.instanceName!==c.instanceName||!['open','close','connecting'].includes(String(i.state)))
   throw channelError('EVOLUTION_STATE_MISMATCH','PROVIDER');
  return i.state as EvolutionState;
 }
 async verifyWebhook(c:EvolutionCredential,callback:string):Promise<void>{
  const found=await this.call(c,'GET','/webhook/find'),w=object(found.webhook??found);
  const h=object(w.headers);
  if(w.enabled!==true||w.url!==callback||w.webhookByEvents!==false||
   w.webhookBase64!==false||!Array.isArray(w.events)||w.events.length!==2||
   !w.events.includes('MESSAGES_UPSERT')||!w.events.includes('MESSAGES_UPDATE')||
   !evolutionTokenEqual(h['x-av-evolution-auth'],c.webhookToken))
   throw channelError('EVOLUTION_WEBHOOK_MISMATCH','PROVIDER');
 }
 async configureWebhook(c:EvolutionCredential,callback:string):Promise<void>{
  await this.call(c,'POST','/webhook/set',{webhook:{enabled:true,url:callback,byEvents:false,base64:false,
   events:['MESSAGES_UPSERT','MESSAGES_UPDATE'],headers:{'x-av-evolution-auth':c.webhookToken}}});
  await this.verifyWebhook(c,callback);
 }
 async qr(c:EvolutionCredential):Promise<string>{
  return evolutionQr(await this.call(c,'GET','/instance/connect'));
 }
 async logout(c:EvolutionCredential):Promise<void>{
  await this.call(c,'DELETE','/instance/logout');
  if(await this.state(c)!=='close')throw channelError('EVOLUTION_LOGOUT_UNCONFIRMED','PROVIDER');
 }
 /** No public send route. Caller must enforce contact consent and durable outbox. */
 async sendText(c:EvolutionCredential,recipient:string,text:string):Promise<string>{
  if(!/^[1-9][0-9]{9,14}$/.test(recipient)||!text.trim()||text.length>4096)
   throw channelError('EVOLUTION_SEND_INVALID','VALIDATION');
  if(await this.state(c)!=='open')throw channelError('EVOLUTION_NOT_CONNECTED');
  const r=await this.call(c,'POST','/message/sendText',{number:recipient,text});
  const k=object(r.key);
  if(k.fromMe!==true||k.remoteJid!==recipient+'@s.whatsapp.net'||
   typeof k.id!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(k.id))
   throw channelError('EVOLUTION_SEND_UNCERTAIN','PROVIDER');
  return k.id;
 }
}
export function evolutionEventId(t:string,u:string,id:string):string{
 return createHash('sha256').update(JSON.stringify([t,u,'EVOLUTION',id])).digest('hex');
}
