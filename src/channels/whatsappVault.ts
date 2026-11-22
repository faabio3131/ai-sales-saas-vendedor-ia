import {applicationDefault} from 'firebase-admin/app';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {channelError,whatsappVaultReference,type WhatsAppConnection} from './whatsappConnections';

export interface WhatsAppSecrets{
 tenantId:string;unitId:string;phoneNumberId:string;wabaId:string;
 accessToken:string;appSecret:string;verifyToken:string;
}
export interface WhatsAppCredentialsVault{load(conn:WhatsAppConnection):Promise<WhatsAppSecrets>;}
function check(conn:WhatsAppConnection,secret:unknown):WhatsAppSecrets{
 if(!secret||typeof secret!=='object'||Array.isArray(secret))
  throw channelError('CHANNEL_VAULT_INVALID');
 const data=secret as WhatsAppSecrets;
 if(data.tenantId!==conn.tenantId||data.unitId!==conn.unitId||
  data.phoneNumberId!==conn.phoneNumberId||data.wabaId!==conn.wabaId||
  typeof data.accessToken!=='string'||data.accessToken.length<15||
  typeof data.appSecret!=='string'||data.appSecret.length<16||
  typeof data.verifyToken!=='string'||data.verifyToken.length<16)
  throw channelError('CHANNEL_VAULT_BINDING_MISMATCH');
 return data;
}
export class MountedWhatsAppVault implements WhatsAppCredentialsVault{
 constructor(private readonly root=process.env.WHATSAPP_SECRET_MOUNT_DIR??'/run/secrets/atendevende-whatsapp'){}
 async load(conn:WhatsAppConnection){
  if(!conn.credentialRef||conn.credentialRef!==whatsappVaultReference(conn.tenantId,conn.unitId,'MOUNTED')||
    !path.isAbsolute(this.root))throw channelError('CHANNEL_VAULT_REF_INVALID');
  const file=path.join(this.root,conn.credentialRef.slice(8)+'.json');
  try{
   const [rootStat,stat]=await Promise.all([lstat(this.root),lstat(file)]);
   if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o022)!==0||!stat.isFile()||
    stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size===0||stat.size>16384)
    throw new Error('Unsafe secret mount');
   return check(conn,JSON.parse(await readFile(file,'utf8')));
  }catch{throw channelError('CHANNEL_VAULT_UNAVAILABLE','PROVIDER');}
 }
}
export class GoogleWhatsAppVault implements WhatsAppCredentialsVault{
 constructor(private readonly fetchImpl:typeof fetch=fetch){}
 async load(conn:WhatsAppConnection){
  const ref=conn.credentialRef;
  if(!ref||!/^projects\/[a-zA-Z0-9_-]{4,80}\/secrets\/avwa-[a-f0-9]{48}\/versions\/(?:latest|[1-9][0-9]*)$/.test(ref)||
   !ref.includes('/secrets/avwa-'+whatsappVaultReference(conn.tenantId,conn.unitId,'MOUNTED').slice(8,56)+'/'))
   throw channelError('CHANNEL_VAULT_REF_INVALID');
  let token:string;
  try{token=(await applicationDefault().getAccessToken()).access_token;}
  catch{throw channelError('CHANNEL_VAULT_AUTH_FAILED','PROVIDER');}
  let response:Response;
  try{response=await this.fetchImpl('https://secretmanager.googleapis.com/v1/'+ref+':access',{
   headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000),
  });}catch{throw channelError('CHANNEL_VAULT_UNAVAILABLE','PROVIDER');}
  if(!response.ok)throw channelError('CHANNEL_VAULT_DENIED');
  let decoded:unknown;
  try{
   const payload=await response.json() as {payload?:{data?:string}};
   if(!payload.payload?.data)throw new Error('No secret payload');
   decoded=JSON.parse(Buffer.from(payload.payload.data,'base64').toString('utf8'));
  }catch{throw channelError('CHANNEL_VAULT_INVALID');}
  return check(conn,decoded);
 }
}
export function createWhatsAppVault():WhatsAppCredentialsVault{
 return process.env.WHATSAPP_VAULT_BACKEND==='MOUNTED'
  ?new MountedWhatsAppVault():new GoogleWhatsAppVault();
}
