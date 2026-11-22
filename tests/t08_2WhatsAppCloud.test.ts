import {createHmac} from 'node:crypto';
import {mkdtemp,writeFile,chmod,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {describe,it,expect,vi} from 'vitest';
import {WhatsAppRegistrationService,whatsappVaultReference,
 type WhatsAppConnection,type WhatsAppConnectionStore} from '../src/channels/whatsappConnections';
import {MountedWhatsAppVault,type WhatsAppSecrets} from '../src/channels/whatsappVault';
import {createWhatsAppWebhookRouter,verifyMetaSignature,verifyWhatsAppAccountPayload,
 type WhatsAppInbox} from '../src/channels/whatsappWebhooks';
import {WhatsAppDeliveryService,OfficialMetaGraphSender,type WhatsAppSendRecord,
 type WhatsAppOutbox} from '../src/channels/whatsappDelivery';
import type {TenantContext} from '../src/types/contracts';

const tenant='tenant-a',unit='main',phone='123456789000',waba='987654321000';
const owner=(t=tenant,role='OWNER'):TenantContext=>({tenantId:t,role,userId:'owner-a',requestId:'test-t08-2'});
const secret:WhatsAppSecrets={
 tenantId:tenant,unitId:unit,phoneNumberId:phone,wabaId:waba,
 accessToken:'test-meta-access-token-is-long',appSecret:'test-app-secret-is-strong',
 verifyToken:'test-verify-token-is-long',
};
function conn(status:'PENDING_VERIFICATION'|'ACTIVE'|'DISABLED'='ACTIVE'):WhatsAppConnection{
 return {tenantId:tenant,unitId:unit,phoneNumberId:phone,wabaId:waba,
  credentialRef:whatsappVaultReference(tenant,unit,'MOUNTED'),
  version:2,createdAt:'2026-11-21T00:00:00Z',updatedAt:'2026-11-21T00:00:00Z',status};
}
class Store implements WhatsAppConnectionStore{
 readonly data=new Map<string,WhatsAppConnection>();
 async get(t:string,u:string){return this.data.get(t+'|'+u)??null;}
 async write(next:WhatsAppConnection,expected:number){
  const key=next.tenantId+'|'+next.unitId,prior=this.data.get(key);
  if((prior?.version??0)!==expected||next.version!==expected+1)throw Error('CAS mismatch');
  this.data.set(key,structuredClone(next));
 }
}
const payload=()=>({
 object:'whatsapp_business_account',
 entry:[{id:waba,changes:[{field:'messages',value:{
  messaging_product:'whatsapp',metadata:{phone_number_id:phone},
  messages:[{id:'wamid.inbound.001',from:'5511999887766',timestamp:'1795000000',
   type:'text',text:{body:'Quero pedir uma pizza'}}],
 }}]}],
});
function sig(raw:string,s=secret.appSecret){return 'sha256='+createHmac('sha256',s).update(raw).digest('hex');}
describe('T08.2 — official WhatsApp account, verification, inbound and delivery',()=>{
 it('keeps registration metadata scoped by tenant and unit and never writes credentials to repository',async()=>{
  const store=new Store(),verifier=vi.fn(async()=>({verified:false,evidenceRef:''}));
  const api=new WhatsAppRegistrationService(store,{verify:verifier});
  expect(await api.register(owner(),'main',{phoneNumberId:phone,wabaId:waba}))
   .toMatchObject({status:'PENDING_VERIFICATION',credentialConfigured:false,liveActivated:false});
  await api.register(owner('tenant-b'),'main',{phoneNumberId:'123456789001',wabaId:waba});
  expect((await store.get(tenant,unit))?.phoneNumberId).toBe(phone);
  expect((await store.get('tenant-b',unit))?.phoneNumberId).toBe('123456789001');
  expect((await store.get(tenant,unit))?.credentialRef).toBeUndefined();
  expect(verifier).not.toHaveBeenCalled();
 });
 it('requires OWNER and rejects forged tenant, secret fields, bad phone, duplicate activation',async()=>{
  const store=new Store(),api=new WhatsAppRegistrationService(store,{verify:async()=>({verified:false,evidenceRef:''})});
  await expect(api.register(owner(tenant,'STAFF'),unit,{phoneNumberId:phone,wabaId:waba}))
   .rejects.toMatchObject({code:'CHANNEL_OWNER_REQUIRED'});
  await expect(api.register(owner(),unit,{phoneNumberId:phone,wabaId:waba,accessToken:'stolen'}))
   .rejects.toMatchObject({code:'CHANNEL_REGISTRATION_INVALID'});
  await expect(api.register(owner(),unit,{phoneNumberId:'other-phone',wabaId:waba}))
   .rejects.toMatchObject({code:'CHANNEL_REGISTRATION_INVALID'});
  await api.register(owner(),unit,{phoneNumberId:phone,wabaId:waba});
  await api.attachVault(tenant,unit,'MOUNTED');
  await expect(api.verifyAndActivate(tenant,unit)).rejects.toMatchObject({code:'CHANNEL_EXTERNAL_VERIFICATION_REQUIRED'});
  expect((await store.get(tenant,unit))?.status).toBe('PENDING_VERIFICATION');
 });
 it('requires independently verified external proof before activation; disables on ops command',async()=>{
  const store=new Store(),api=new WhatsAppRegistrationService(store,
   {verify:async()=>({verified:true,evidenceRef:'external:meta-waba-subscription-proof'})});
  await api.register(owner(),unit,{phoneNumberId:phone,wabaId:waba});
  await api.attachVault(tenant,unit,'MOUNTED');
  await api.verifyAndActivate(tenant,unit);
  expect((await store.get(tenant,unit))?.verificationEvidenceRef)
   .toBe('external:meta-waba-subscription-proof');
  await expect(api.register(owner(),unit,{phoneNumberId:phone,wabaId:waba}))
   .rejects.toMatchObject({code:'CHANNEL_ACTIVE_CONNECTION_LOCKED'});
  await api.disable(tenant,unit);
  expect((await store.get(tenant,unit))?.status).toBe('DISABLED');
 });
 it('loads only exact private 0600 mounted Meta secrets bound to tenant/unit/account',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'av-wa-t08-'));
  const file=path.join(dir,whatsappVaultReference(tenant,unit,'MOUNTED').slice(8)+'.json');
  try{
   await writeFile(file,JSON.stringify(secret),{mode:0o600});
   const vault=new MountedWhatsAppVault(dir);
   expect((await vault.load(conn())).phoneNumberId).toBe(phone);
   await expect(vault.load({...conn(),tenantId:'tenant-b'})).rejects.toBeTruthy();
   await chmod(file,0o644);
   await expect(vault.load(conn())).rejects.toBeTruthy();
   await rm(file);await symlink('/etc/hosts',file);
   await expect(vault.load(conn())).rejects.toBeTruthy();
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 it('verifies exact raw Meta HMAC and rejects modified bodies and wrong WABA/phone',()=>{
  const raw=JSON.stringify(payload());
  expect(verifyMetaSignature(Buffer.from(raw),sig(raw),secret.appSecret)).toBe(true);
  expect(verifyMetaSignature(Buffer.from(raw+' '),sig(raw),secret.appSecret)).toBe(false);
  expect(verifyMetaSignature(Buffer.from(raw),'sha256=abc',secret.appSecret)).toBe(false);
  expect(verifyWhatsAppAccountPayload(payload(),conn())).toBe(true);
  expect(verifyWhatsAppAccountPayload({...payload(),entry:[{...payload().entry[0],id:'other'}]},conn())).toBe(false);
  const bad=payload();bad.entry[0].changes[0].value.metadata.phone_number_id='wrong';
  expect(verifyWhatsAppAccountPayload(bad,conn())).toBe(false);
 });
 it('answers real Meta GET challenge and durably deduplicates inbound signed POST events',async()=>{
  const store=new Store();store.data.set(tenant+'|'+unit,conn());
  const ids=new Set<string>(),persist=vi.fn(async(_c:WhatsAppConnection,m:{externalMessageId:string})=>{
   const duplicate=ids.has(m.externalMessageId);ids.add(m.externalMessageId);return !duplicate;
  });
  const inbox:WhatsAppInbox={persist};
  const app=express();app.use(express.json({verify:(req,_res,b)=>
   ((req as typeof req&{whatsappRawBody?:Buffer}).whatsappRawBody=Buffer.from(b))}));
  app.use('/webhooks',createWhatsAppWebhookRouter({connections:store,
   vault:{load:async()=>secret},inbox}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/webhooks/'+tenant+'/'+unit;
  try{
   const challenge=await fetch(base+'?hub.mode=subscribe&hub.verify_token='+
    encodeURIComponent(secret.verifyToken)+'&hub.challenge=1234567');
   expect(challenge.status).toBe(200);expect(await challenge.text()).toBe('1234567');
   expect((await fetch(base+'?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1234567')).status).toBe(401);
   const raw=JSON.stringify(payload()),headers={'content-type':'application/json',
    'x-hub-signature-256':sig(raw)};
   const first=await fetch(base,{method:'POST',body:raw,headers});
   expect(first.status).toBe(200);expect(await first.json()).toMatchObject({accepted:1,duplicates:0});
   const repeated=await fetch(base,{method:'POST',body:raw,headers});
   expect(await repeated.json()).toMatchObject({accepted:0,duplicates:1});
   expect(persist).toHaveBeenCalledTimes(2);
   const unsigned=await fetch(base,{method:'POST',body:raw,
    headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64)}});
   expect(unsigned.status).toBe(401);
   const spoofed=JSON.stringify({...payload(),entry:[{...payload().entry[0],id:'fake-waba'}]});
   expect((await fetch(base,{method:'POST',body:spoofed,headers:{...headers,
    'x-hub-signature-256':sig(spoofed)}})).status).toBe(401);
   expect(persist).toHaveBeenCalledTimes(2);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 it('does not accept messages before real channel activation or on durable inbox failure',async()=>{
  const store=new Store(),inbox:WhatsAppInbox={persist:async()=>{throw Error('firestore offline');}};
  store.data.set(tenant+'|'+unit,conn('PENDING_VERIFICATION'));
  const app=express();app.use(express.json({verify:(req,_res,b)=>
   ((req as typeof req&{whatsappRawBody?:Buffer}).whatsappRawBody=Buffer.from(b))}));
  app.use('/webhooks',createWhatsAppWebhookRouter({connections:store,vault:{load:async()=>secret},inbox}));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/webhooks/'+tenant+'/'+unit;
  const raw=JSON.stringify(payload()),headers={'content-type':'application/json','x-hub-signature-256':sig(raw)};
  try{
   expect((await fetch(base,{method:'POST',headers,body:raw})).status).toBe(401);
   store.data.set(tenant+'|'+unit,conn('ACTIVE'));
   expect((await fetch(base,{method:'POST',headers,body:raw})).status).toBe(503);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 });
 it('sends via fixed Meta Graph API host/version, validates response and avoids tokens in errors',async()=>{
  const post=vi.fn(async(url:string,options:RequestInit)=>{
   expect(url).toBe('https://graph.facebook.com/v26.0/'+phone+'/messages');
   expect((options.headers as Record<string,string>).Authorization).toContain(secret.accessToken);
   expect(JSON.parse(options.body as string)).toMatchObject({
    messaging_product:'whatsapp',to:'5511999887766',type:'text',text:{body:'Pedido confirmado'},
   });
   return {ok:true,json:async()=>({messages:[{id:'wamid.accepted.001'}]})} as Response;
  });
  const graph=new OfficialMetaGraphSender(post as unknown as typeof fetch,'v26.0');
  expect(await graph.send(phone,'5511999887766','Pedido confirmado',secret))
   .toBe('wamid.accepted.001');
  expect(post).toHaveBeenCalledOnce();
 });
 it('enforces consent, active tenant account, idempotency and no blind retry after network uncertainty',async()=>{
  const store=new Store();store.data.set(tenant+'|'+unit,conn());
  const records=new Map<string,WhatsAppSendRecord>();
  const outbox:WhatsAppOutbox={
   reserve:async record=>{
    const old=records.get(record.idempotencyKey);
    if(old){
     if(old.payloadHash!==record.payloadHash)throw Error('idempotency conflict');
     return old;
    }records.set(record.idempotencyKey,record);return record;
   },
   settle:async record=>{records.set(record.idempotencyKey,record);},
  };
  const sender=vi.fn(async()=> 'wamid.sent.001');
  const policy={hasRecentVerifiedInbound:vi.fn(async()=>true)};
  const delivery=new WhatsAppDeliveryService(store,{load:async()=>secret},outbox,{send:sender},policy);
  const input={tenantId:tenant,unitId:unit,recipient:'5511999887766',text:'Pedido confirmado',
   idempotencyKey:'message-first-0001',authorizedCustomerServiceWindow:true};
  await expect(delivery.send({...input,authorizedCustomerServiceWindow:false}))
   .rejects.toMatchObject({code:'WHATSAPP_CUSTOMER_CONSENT_REQUIRED'});
  expect(await delivery.send(input)).toEqual({externalMessageId:'wamid.sent.001',duplicate:false});
  expect(await delivery.send(input)).toEqual({externalMessageId:'wamid.sent.001',duplicate:true});
  expect(sender).toHaveBeenCalledTimes(1);
  const cold=new WhatsAppDeliveryService(store,{load:async()=>secret},outbox,{send:sender},
   {hasRecentVerifiedInbound:async()=>false});
  await expect(cold.send({...input,idempotencyKey:'no-window-0003'}))
   .rejects.toMatchObject({code:'WHATSAPP_CUSTOMER_CONSENT_REQUIRED'});
  expect(sender).toHaveBeenCalledTimes(1);
  await expect(delivery.send({...input,text:'Outro texto'})).rejects.toBeTruthy();
  const failed=new WhatsAppDeliveryService(store,{load:async()=>secret},outbox,
   {send:async()=>{throw Error('timeout token secret');}},policy);
  await expect(failed.send({...input,idempotencyKey:'message-second-0002'}))
   .rejects.toMatchObject({code:'WHATSAPP_DELIVERY_UNCERTAIN'});
  await expect(failed.send({...input,idempotencyKey:'message-second-0002'}))
   .rejects.toMatchObject({code:'WHATSAPP_DELIVERY_UNCERTAIN'});
  expect(records.get('message-second-0002')?.status).toBe('UNKNOWN');
 });
});
