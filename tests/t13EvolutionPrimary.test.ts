import {readFileSync} from 'node:fs';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {errorHandler} from '../src/api/middleware/errorHandler';
import {describe,it,expect,vi} from 'vitest';
import {channelError,evolutionReconciliationPending} from '../src/channels/whatsappConnections';
import {GoogleEvolutionVault,EvolutionV2Client,evolutionInstance,evolutionSecretId,evolutionOrigin,evolutionQr,validateEvolutionCredential,
 type EvolutionCredential} from '../src/channels/evolutionClient';
import {EvolutionPairingService,parseEvolutionInbound,createEvolutionRouter,createEvolutionWebhookRouter,type EvolutionStore} from '../src/channels/evolutionPairing';
import type {TenantContext} from '../src/types/contracts';

const t='tenant-evo-a',u='main',origin='https://evolution-app.atendevendeia.com.br';
const ctx=(tenantId=t,role='OWNER'):TenantContext=>({tenantId,role,userId:'owner',requestId:'test'});
const credentials=(tenantId=t,unitId=u):EvolutionCredential=>({tenantId,unitId,
 instanceName:evolutionInstance(tenantId,unitId),apiKey:'A'.repeat(40),webhookToken:'B'.repeat(40),expectedOwnerPhone:'5511987654321'});
const c=credentials();
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=';
const qr='data:image/png;base64,'+image;
const callback='https://app.atendevendeia.com.br/api/channels/webhooks/evolution/'+t+'/'+u;
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
function setup(){
 let binding:Awaited<ReturnType<EvolutionStore['get']>>=null;
 const seen=new Set<string>();
 const store:EvolutionStore={
  async acquire(s,leaseId,_exclusive,purpose){
   if(purpose==='logout'&&(!binding||binding.status==='DISCONNECTED'&&!binding.ownerPhone&&!evolutionReconciliationPending(binding.reconciliationRequired)))
    throw channelError('EVOLUTION_NO_ACTIVE_BINDING','CONFLICT');
   const pause=evolutionReconciliationPending(binding?.reconciliationRequired)||purpose==='logout'||
    (!!binding?.ownerPhone&&(purpose==='connect'||purpose==='confirm'&&binding.status!=='CONNECTED'));
   binding={...s,instanceName:evolutionInstance(s.tenantId,s.unitId),status:binding?.status==='CONNECTED'||binding?.status==='PAIRING'?binding.status:'UNKNOWN',
    ...(binding?.ownerPhone?{ownerPhone:binding.ownerPhone}:{}),...(pause?{reconciliationRequired:true}:{}),leaseId,leaseUntil:Date.now()+120000,updatedAt:new Date().toISOString()};
   return pause;
  },
  async finish(s,leaseId,status,ownerPhone){if(!binding||binding.tenantId!==s.tenantId||binding.unitId!==s.unitId||binding.leaseId!==leaseId)throw Error('scope or lease');
   binding={...binding,...(status===undefined?{}:{status}),leaseId:'',leaseUntil:0,...(ownerPhone?{ownerPhone}:{})};
   if(status==='DISCONNECTED'){delete binding.ownerPhone;delete binding.reconciliationRequired;}
   else if(status==='UNKNOWN'&&binding.ownerPhone)binding.reconciliationRequired=true;},
  async get(s){return binding?.tenantId===s.tenantId&&binding.unitId===s.unitId?binding:null;},
  async persist(s,id){const key=evolutionInstance(s.tenantId,s.unitId)+id;if(seen.has(key))return false;seen.add(key);return true;},
 };
 const client={state:vi.fn<()=>Promise<'open'|'close'|'connecting'>>(async()=> 'close'),
  configureWebhook:vi.fn(async()=>{}),verifyWebhook:vi.fn(async()=>{}),qr:vi.fn(async()=>qr),logout:vi.fn(async()=>{}),ownerPhone:vi.fn(async()=>c.expectedOwnerPhone)};
 const vault={load:vi.fn(async(tenantId:string,unitId:string)=>credentials(tenantId,unitId))};
 const pairingEnabled=vi.fn(()=>true),inboundEnabled=vi.fn(()=>false),metaActive=vi.fn(async()=>false);
 const authorizeUnit=vi.fn(async()=>{});
 const service=new EvolutionPairingService({store,vault,client,authorizeUnit,metaActive,pairingEnabled,inboundEnabled,
  callback:s=>'https://app.atendevendeia.com.br/api/channels/webhooks/evolution/'+s.tenantId+'/'+s.unitId});
 return {service,client,vault,store,pairingEnabled,inboundEnabled,metaActive,authorizeUnit};
}
function payload(instance=c.instanceName){return {event:'messages.upsert',instance,data:{
 key:{id:'inbound_1',fromMe:false,remoteJid:'5511999999999@s.whatsapp.net'},message:{conversation:'Olá'},messageTimestamp:Math.floor(Date.now()/1000)}};}
describe('Evolution primary channel — provider contract and isolated QR',()=>{
 it('derives distinct immutable instance and vault names and rejects foreign credentials',()=>{
  expect(evolutionInstance(t,u)).not.toBe(evolutionInstance('tenant-evo-b',u));
  expect(evolutionInstance(t,u)).not.toBe(evolutionInstance(t,'filial'));
  expect(evolutionSecretId(t,u)).not.toBe(evolutionSecretId(t,'filial'));
  expect(validateEvolutionCredential(t,u,c)).toEqual(c);
  expect(()=>validateEvolutionCredential('tenant-evo-b',u,c)).toThrow();
  expect(()=>validateEvolutionCredential(t,u,{...c,webhookToken:c.apiKey})).toThrow();
  expect(()=>evolutionOrigin('https://api.atendevendeia.com.br')).toThrow();
  expect(()=>evolutionOrigin(origin+'/path')).toThrow();
 });
 it('distinguishes malformed vault payload, unavailable access and scoped credential mismatch',async()=>{
  const prior=process.env.FIREBASE_PROJECT_ID;process.env.FIREBASE_PROJECT_ID='demo-evolution-ci';
  try{
   const load=vi.fn<typeof fetch>();
   const vault=new GoogleEvolutionVault(load,async()=> 'fixture-access-token');
   load.mockResolvedValueOnce(response({payload:{data:Buffer.from('not-json').toString('base64')}}));
   await expect(vault.load(t,u)).rejects.toMatchObject({code:'EVOLUTION_VAULT_INVALID'});
   load.mockResolvedValueOnce(response({payload:{data:Buffer.from(JSON.stringify(credentials('other-tenant',u))).toString('base64')}}));
   await expect(vault.load(t,u)).rejects.toMatchObject({code:'EVOLUTION_VAULT_BINDING_MISMATCH'});
   load.mockResolvedValueOnce(response({payload:{data:Buffer.from(JSON.stringify(c)).toString('base64')}}));
   expect(await vault.load(t,u)).toEqual(c);
   load.mockResolvedValueOnce(response({},404));expect(await vault.load(t,u)).toBeNull();
   load.mockRejectedValueOnce(Error('transport'));await expect(vault.load(t,u)).rejects.toMatchObject({code:'EVOLUTION_VAULT_UNAVAILABLE'});
  }finally{if(prior===undefined)delete process.env.FIREBASE_PROJECT_ID;else process.env.FIREBASE_PROJECT_ID=prior;}
 });
 it('requires exact verified owner number from an instance-scoped provider readback',async()=>{
  const mock=vi.fn<typeof fetch>().mockResolvedValueOnce(response([{name:c.instanceName,connectionStatus:'open',ownerJid:c.expectedOwnerPhone+':1@s.whatsapp.net'}]))
   .mockResolvedValueOnce(response([{name:c.instanceName,connectionStatus:'open',ownerJid:'5511000000000@s.whatsapp.net'}]))
   .mockResolvedValueOnce(response([{name:'foreign',connectionStatus:'open',ownerJid:c.expectedOwnerPhone+'@s.whatsapp.net'}]));
  const api=new EvolutionV2Client(origin,mock);
  expect(await api.ownerPhone(c)).toBe(c.expectedOwnerPhone);
  expect(mock.mock.calls[0][0]).toBe(origin+'/instance/fetchInstances?instanceName='+c.instanceName);
  await expect(api.ownerPhone(c)).rejects.toMatchObject({code:'EVOLUTION_OWNER_UNVERIFIED'});
  await expect(api.ownerPhone(c)).rejects.toMatchObject({code:'EVOLUTION_OWNER_UNVERIFIED'});
 });
 it('never treats a V4 logout 400 and scoped close readback as successful revocation',async()=>{
  const scoped=(state:'open'|'close'|'connecting')=>response({instance:{instanceName:c.instanceName,state}});
  const mock=vi.fn<typeof fetch>()
   .mockResolvedValueOnce(response({status:400,error:'Bad Request',response:{message:['instance is not connected']}},400))
   .mockResolvedValueOnce(scoped('close'));
  const api=new EvolutionV2Client(origin,mock);
  await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_LOGOUT_RECONCILIATION_REQUIRED',statusCode:409});
  expect(mock.mock.calls.map(([url,options])=>[url,options?.method])).toEqual([
   [origin+'/instance/logout/'+c.instanceName,'DELETE'],
   [origin+'/instance/connectionState/'+c.instanceName,'GET']]);
  expect(mock.mock.calls.every(([,options])=>new Headers(options?.headers).get('apikey')===c.apiKey)).toBe(true);
  for(const state of ['open','connecting'] as const){
   mock.mockResolvedValueOnce(response({error:'fixture rejection'},400)).mockResolvedValueOnce(scoped(state));
   await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_PROVIDER_REJECTED'});
  }
  mock.mockResolvedValueOnce(response({},400)).mockResolvedValueOnce(response({instance:{instanceName:'foreign',state:'close'}}));
  await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_PROVIDER_REJECTED'});
  mock.mockResolvedValueOnce(response({},400)).mockRejectedValueOnce(Error('readback failed'));
  await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_PROVIDER_REJECTED'});
  for(const status of [401,403,404,500]){
   const before=mock.mock.calls.length;
   mock.mockResolvedValueOnce(response({},status));
   await expect(api.logout(c)).rejects.toMatchObject({code:status===404?'EVOLUTION_INSTANCE_NOT_PROVISIONED':'EVOLUTION_PROVIDER_REJECTED'});
   expect(mock.mock.calls).toHaveLength(before+1);
  }
  for(const invalid of [{},{status:'SUCCESS',error:true,response:{message:'Instance logged out'}},
   {status:'SUCCESS',error:false,response:{message:'other operation'}},{status:'SUCCESS',error:false,response:[]}]){
   const before=mock.mock.calls.length;
   mock.mockResolvedValueOnce(response(invalid));
   await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_LOGOUT_UNCONFIRMED'});
   expect(mock.mock.calls).toHaveLength(before+1);
  }
  mock.mockResolvedValueOnce(new Response('<html>not a receipt</html>',{status:200}));
  await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_LOGOUT_UNCONFIRMED'});
  mock.mockResolvedValueOnce(response({status:'SUCCESS',error:false,response:{message:'Instance logged out'}})).mockRejectedValueOnce(Error('readback unavailable'));
  await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_LOGOUT_UNCONFIRMED'});
  mock.mockResolvedValueOnce(response({status:'SUCCESS',error:false,response:{message:'Instance logged out'}})).mockResolvedValueOnce(scoped('open'));
  await expect(api.logout(c)).rejects.toMatchObject({code:'EVOLUTION_LOGOUT_UNCONFIRMED'});
  mock.mockResolvedValueOnce(response({status:'SUCCESS',error:false,response:{message:'Instance logged out'}})).mockResolvedValueOnce(scoped('close'));
  await expect(api.logout(c)).resolves.toBeUndefined();
 });
 it('accepts only bounded PNG data and rejects invalid or non-image URLs',()=>{
  expect(evolutionQr({base64:qr})).toBe(qr);
  expect(evolutionQr({qrcode:{base64:image}})).toBe(qr);
  for(const x of ['https://other.invalid/qr','data:image/svg+xml;base64,AAAA','AAAA','A'.repeat(220001)])
   expect(()=>evolutionQr({base64:x})).toThrow();
 });
 it('uses the installed v2 nested webhook schema, exact scope, no redirects and verifies readback',async()=>{
  const mock=vi.fn<typeof fetch>().mockResolvedValueOnce(response({ok:true}))
   .mockResolvedValueOnce(response({webhook:{enabled:true,url:callback,webhookByEvents:false,
    webhookBase64:false,events:['MESSAGES_UPSERT','MESSAGES_UPDATE'],headers:{'x-av-evolution-auth':c.webhookToken}}}));
  const api=new EvolutionV2Client(origin,mock);
  await api.configureWebhook(c,callback);
  const [url,opts]=mock.mock.calls[0];
  expect(url).toBe(origin+'/webhook/set/'+c.instanceName);
  expect(opts?.redirect).toBe('error');
  expect(JSON.parse(String(opts?.body))).toEqual({webhook:{enabled:true,url:callback,byEvents:false,base64:false,
   events:['MESSAGES_UPSERT','MESSAGES_UPDATE'],headers:{'x-av-evolution-auth':c.webhookToken}}});
  mock.mockResolvedValueOnce(response({instance:{instanceName:'another',state:'open'}}));
  await expect(api.state(c)).rejects.toMatchObject({code:'EVOLUTION_STATE_MISMATCH'});
  mock.mockResolvedValueOnce(response({webhook:{enabled:true,url:callback,webhookByEvents:false,
   webhookBase64:false,events:['MESSAGES_UPSERT','MESSAGES_UPDATE'],headers:{'x-av-evolution-auth':'wrong'}}}));
  await expect(api.verifyWebhook(c,callback)).rejects.toMatchObject({code:'EVOLUTION_WEBHOOK_MISMATCH'});
 });
 it('does not allow STAFF, inactive plan, disabled or ambiguous Meta connection to start pairing',async()=>{
  const x=setup();
  await expect(x.service.connect(ctx(t,'STAFF'),u)).rejects.toMatchObject({code:'EVOLUTION_OWNER_REQUIRED'});
  x.authorizeUnit.mockRejectedValueOnce(Error('plan'));
  await expect(x.service.connect(ctx(),u)).rejects.toThrow('plan');
  x.pairingEnabled.mockReturnValueOnce(false);
  expect(await x.service.connect(ctx(),u)).toEqual({status:'DISABLED',connected:false,commercialEnabled:false});
  x.metaActive.mockResolvedValueOnce(true);
  await expect(x.service.connect(ctx(),u)).rejects.toMatchObject({code:'EVOLUTION_META_ACTIVE_CONFLICT'});
  expect(x.client.qr).not.toHaveBeenCalled();
 });
 it('returns a temporary QR only after webhook configuration; confirms actual open state after scan',async()=>{
  const x=setup();
  expect(await x.service.connect(ctx(),u)).toEqual({status:'PAIRING',connected:false,qrCode:qr,expiresInSeconds:30,commercialEnabled:false});
  expect(x.client.configureWebhook).toHaveBeenCalledWith(c,callback);
  expect(JSON.stringify(await x.store.get({tenantId:t,unitId:u}))).not.toContain(image);
  x.client.state.mockResolvedValue('open');
  expect(await x.service.confirm(ctx(),u)).toEqual({status:'CONNECTED',connected:true,commercialEnabled:false});
  expect(await x.service.status(ctx(),u)).toMatchObject({connected:true,status:'CONNECTED'});
  expect(x.client.verifyWebhook).toHaveBeenCalledWith(c,callback);
  expect(await x.service.status(ctx('tenant-evo-b'),u)).toMatchObject({connected:false});
 });
 it('disconnection is not activation and checks the same scoped credential',async()=>{
  const x=setup();x.client.state.mockResolvedValue('open');
  await x.service.connect(ctx(),u);
  expect(await x.service.disconnect(ctx(),u)).toMatchObject({connected:false,status:'DISCONNECTED'});
  expect(x.client.logout).toHaveBeenCalledWith(c);
 });
 it('rejects a repeated or unregistered logout without mutating the binding or calling the provider',async()=>{
  const x=setup(),s={tenantId:t,unitId:u};
  await expect(x.service.disconnect(ctx(),u)).rejects.toMatchObject({code:'EVOLUTION_NO_ACTIVE_BINDING'});
  expect(await x.store.get(s)).toBeNull();expect(x.client.logout).not.toHaveBeenCalled();
  x.client.state.mockResolvedValue('open');await x.service.connect(ctx(),u);await x.service.disconnect(ctx(),u);
  const before=await x.store.get(s);x.client.logout.mockClear();
  await expect(x.service.disconnect(ctx(),u)).rejects.toMatchObject({code:'EVOLUTION_NO_ACTIVE_BINDING'});
  expect(await x.store.get(s)).toEqual(before);expect(x.client.logout).not.toHaveBeenCalled();
 });
 it('preserves connected state on ambiguous logout/confirm and never masks the provider error',async()=>{
  const x=setup();x.client.state.mockResolvedValue('open');await x.service.connect(ctx(),u);
  x.client.logout.mockRejectedValueOnce(Error('logout timeout'));
  await expect(x.service.disconnect(ctx(),u)).rejects.toThrow('logout timeout');
  expect(await x.store.get({tenantId:t,unitId:u})).toMatchObject({status:'CONNECTED',leaseId:'',leaseUntil:0});
  x.client.state.mockRejectedValueOnce(Error('state timeout'));
  await expect(x.service.confirm(ctx(),u)).rejects.toThrow('state timeout');
  expect(await x.store.get({tenantId:t,unitId:u})).toMatchObject({status:'CONNECTED',leaseId:'',leaseUntil:0});
 });
 it('does not turn a transient closed observation into a verified logout',async()=>{
  const x=setup();x.client.state.mockResolvedValue('open');await x.service.connect(ctx(),u);
  x.client.state.mockResolvedValue('close');
  expect(await x.service.confirm(ctx(),u)).toMatchObject({status:'UNKNOWN'});
  expect(await x.store.get({tenantId:t,unitId:u})).toMatchObject({status:'UNKNOWN',ownerPhone:c.expectedOwnerPhone});
  await x.service.disconnect(ctx(),u);
  expect(x.client.logout).toHaveBeenCalledWith(c);
  expect(await x.store.get({tenantId:t,unitId:u})).not.toHaveProperty('ownerPhone');
 });
 it('settles a 400/close logout as UNKNOWN without releasing the owner reservation',async()=>{
  const x=setup();x.client.state.mockResolvedValue('open');await x.service.connect(ctx(),u);
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(response({},400))
   .mockResolvedValueOnce(response({instance:{instanceName:c.instanceName,state:'close'}}));
  x.client.logout.mockImplementationOnce(async()=>new EvolutionV2Client(origin,transport).logout(c));
  await expect(x.service.disconnect(ctx(),u)).rejects.toMatchObject({code:'EVOLUTION_LOGOUT_RECONCILIATION_REQUIRED'});
  expect(await x.store.get({tenantId:t,unitId:u})).toMatchObject({status:'UNKNOWN',ownerPhone:c.expectedOwnerPhone,leaseId:'',leaseUntil:0});
  x.client.state.mockResolvedValue('close');
  expect(await x.service.status(ctx(),u)).toMatchObject({status:'UNKNOWN',connected:false});
  // Plan expiry cannot bypass the pause or release the owner reservation.
  x.authorizeUnit.mockRejectedValueOnce(channelError('EVOLUTION_PLAN_REQUIRED'));
  await expect(x.service.connect(ctx(),u)).rejects.toMatchObject({code:'EVOLUTION_PLAN_REQUIRED'});
  x.authorizeUnit.mockRejectedValueOnce(channelError('EVOLUTION_PLAN_REQUIRED'));
  await expect(x.service.confirm(ctx(),u)).rejects.toMatchObject({code:'EVOLUTION_PLAN_REQUIRED'});
  expect(await x.store.get({tenantId:t,unitId:u})).toMatchObject({status:'UNKNOWN',ownerPhone:c.expectedOwnerPhone,reconciliationRequired:true});
  // Reconnect and confirm only the existing authorized number before explicit logout.
  expect(await x.service.connect(ctx(),u)).toMatchObject({status:'PAIRING',reconciliationRequired:true});
  expect(await x.store.get({tenantId:t,unitId:u})).toMatchObject({ownerPhone:c.expectedOwnerPhone});
  x.client.state.mockResolvedValue('open');
  expect(await x.service.confirm(ctx(),u)).toMatchObject({status:'CONNECTED',reconciliationRequired:true});
  expect(await x.service.status(ctx(),u)).toMatchObject({status:'CONNECTED',reconciliationRequired:true});
  x.inboundEnabled.mockReturnValue(true);
  await expect(x.service.inbound(t,u,c.webhookToken,payload())).rejects.toMatchObject({code:'EVOLUTION_SESSION_BUSY'});
  const falseReceipt=vi.fn<typeof fetch>().mockResolvedValueOnce(response({}));
  x.client.logout.mockImplementationOnce(async()=>new EvolutionV2Client(origin,falseReceipt).logout(c));
  await expect(x.service.disconnect(ctx(),u)).rejects.toMatchObject({code:'EVOLUTION_LOGOUT_UNCONFIRMED'});
  expect(await x.store.get({tenantId:t,unitId:u})).toMatchObject({status:'UNKNOWN',ownerPhone:c.expectedOwnerPhone});
  const validReceipt=vi.fn<typeof fetch>()
   .mockResolvedValueOnce(response({status:'SUCCESS',error:false,response:{message:'Instance logged out'}}))
   .mockResolvedValueOnce(response({instance:{instanceName:c.instanceName,state:'close'}}));
  x.client.logout.mockImplementationOnce(async()=>new EvolutionV2Client(origin,validReceipt).logout(c));
  expect(await x.service.disconnect(ctx(),u)).toMatchObject({status:'DISCONNECTED'});
  expect(await x.store.get({tenantId:t,unitId:u})).not.toHaveProperty('ownerPhone');
  expect(await x.store.get({tenantId:t,unitId:u})).not.toHaveProperty('reconciliationRequired');
 });
 it('drops authenticated status and outgoing echoes before provider readback',async()=>{
  const x=setup();x.client.state.mockResolvedValue('open');await x.service.connect(ctx(),u);
  x.inboundEnabled.mockReturnValue(true);
  x.client.state.mockClear();x.client.verifyWebhook.mockClear();x.client.ownerPhone.mockClear();
  expect(await x.service.inbound(t,u,c.webhookToken,{instance:c.instanceName,event:'MESSAGES_UPDATE'})).toEqual({accepted:0,duplicates:0});
  const echo=payload();echo.data.key.fromMe=true;
  expect(await x.service.inbound(t,u,c.webhookToken,echo)).toEqual({accepted:0,duplicates:0});
  expect(x.client.state).not.toHaveBeenCalled();expect(x.client.verifyWebhook).not.toHaveBeenCalled();expect(x.client.ownerPhone).not.toHaveBeenCalled();
 });
 it('rejects forged instance, groups, outgoing messages, old timestamps and unresolved LID',()=>{
  expect(()=>parseEvolutionInbound(payload('wrong'),c.instanceName)).toThrow();
  for(const jid of ['12345@g.us','12345@lid','status@broadcast']){
   const p=payload();p.data.key.remoteJid=jid;expect(parseEvolutionInbound(p,c.instanceName)).toEqual([]);
  }
  const p=payload();p.data.key.fromMe=true;expect(parseEvolutionInbound(p,c.instanceName)).toEqual([]);
  const old=payload();old.data.messageTimestamp-=90000;expect(parseEvolutionInbound(old,c.instanceName)).toEqual([]);
  expect(parseEvolutionInbound(payload(),c.instanceName)).toHaveLength(1);
 });
 it('keeps inbound disabled by default and requires verified bound session, exact token and durable dedupe',async()=>{
  const x=setup();x.client.state.mockResolvedValue('open');
  await x.service.connect(ctx(),u);
  await expect(x.service.inbound(t,u,c.webhookToken,payload())).rejects.toMatchObject({code:'EVOLUTION_INBOUND_DISABLED'});
  x.inboundEnabled.mockReturnValue(true);
  await expect(x.service.inbound(t,u,'C'.repeat(40),payload())).rejects.toMatchObject({code:'EVOLUTION_WEBHOOK_UNAUTHORIZED'});
  await expect(x.service.inbound('tenant-evo-b',u,c.webhookToken,payload())).rejects.toMatchObject({code:'EVOLUTION_SESSION_NOT_VERIFIED'});
  expect(await x.service.inbound(t,u,c.webhookToken,payload())).toEqual({accepted:1,duplicates:0});
  expect(await x.service.inbound(t,u,c.webhookToken,payload())).toEqual({accepted:0,duplicates:1});
 });
 it('validates send acknowledgement instead of retrying a result with unknown identity',async()=>{
  const mock=vi.fn<typeof fetch>()
   .mockResolvedValueOnce(response({instance:{instanceName:c.instanceName,state:'open'}}))
   .mockResolvedValueOnce(response({key:{fromMe:true,remoteJid:'5511999999999@s.whatsapp.net',id:'out_1'}}));
  const api=new EvolutionV2Client(origin,mock);
  expect(await api.sendText(c,'5511999999999','Resposta autorizada')).toBe('out_1');
  expect(mock.mock.calls[1][0]).toBe(origin+'/message/sendText/'+c.instanceName);
  mock.mockResolvedValueOnce(response({instance:{instanceName:c.instanceName,state:'open'}}))
   .mockResolvedValueOnce(response({key:{fromMe:true,remoteJid:'5511888888888@s.whatsapp.net',id:'other'}}));
  await expect(api.sendText(c,'5511999999999','Resposta')).rejects.toMatchObject({code:'EVOLUTION_SEND_UNCERTAIN'});
 });
});


describe('Evolution dedicated PostgreSQL startup gate',()=>{
 it('waits for the final server and authenticated TCP SQL before releasing the provider',()=>{
  const compose=readFileSync(new URL('../deploy/t13-evolution-provider.compose.yaml',import.meta.url),'utf8');
  const postgres=compose.split('  evolution-postgres:\n')[1].split('  evolution-provider:\n')[0];
  expect(postgres).toContain('test "$$(cat /proc/1/comm)" = postgres &&');
  expect(postgres).toContain('PGPASSWORD="$$(cat /run/secrets/evolution-postgres-password)"');
  expect(postgres).toContain('psql -X -h evolution-postgres -U evolution_commercial -d evolution_commercial -v ON_ERROR_STOP=1 -Atc "SELECT 1") &&');
  expect(postgres).toContain('test "$$result" = 1');
  expect(postgres).not.toContain('pg_isready');
  expect(compose).toContain('evolution-postgres:\n        condition: service_healthy');
 });
});


describe('Evolution offline provider readiness',()=>{
 it('does not depend on external WhatsApp version retrieval and requires authenticated local API response',()=>{
  const compose=readFileSync(new URL('../deploy/t13-evolution-provider.compose.yaml',import.meta.url),'utf8');
  const provider=compose.split('  evolution-provider:\n')[1].split('  evolution-gateway:\n')[0];
  expect(provider).toContain('const key=process.env.AUTHENTICATION_API_KEY;');
  expect(provider).toContain("fetch('http://127.0.0.1:8080/instance/fetchInstances'");
  expect(provider).toContain('headers:{apikey:key}');
  expect(provider).toContain('!Array.isArray(await r.json())');
  expect(provider).not.toContain("fetch('http://127.0.0.1:8080/'");
  expect(compose).toContain('evolution-provider:\n        condition: service_healthy');
 });
});

describe('Evolution HTTP router contracts',()=>{
 it('requires owner scope and authenticates webhook, returns no-store and never exposes a send route',async()=>{
  const x=setup(),app=express();
  app.use(express.json());
  app.use('/manage',(req,_res,next)=>{if(req.header('x-test-member'))req.tenantContext=ctx(t,req.header('x-test-role')??'OWNER');next();},createEvolutionRouter(x.service));
  app.use('/hook',createEvolutionWebhookRouter(x.service));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const root='http://127.0.0.1:'+(server.address() as AddressInfo).port;
   const headers={'x-test-member':'fixture','content-type':'application/json'};
   expect((await fetch(root+'/manage/units/main')).status).toBe(403);
   expect((await fetch(root+'/manage/units/main/connect',{method:'POST',headers:{...headers,'x-test-role':'STAFF'}})).status).toBe(403);
   expect(x.client.configureWebhook).not.toHaveBeenCalled();
   x.client.state.mockResolvedValue('open');
   const connected=await fetch(root+'/manage/units/main/connect',{method:'POST',headers});
   expect(connected.status).toBe(200);expect(connected.headers.get('cache-control')).toBe('no-store');
   expect((await connected.json()).data).toMatchObject({status:'CONNECTED',commercialEnabled:false});
   expect((await fetch(root+'/manage/units/main',{headers})).status).toBe(200);
   expect((await fetch(root+'/manage/units/main/confirm',{method:'POST',headers})).status).toBe(200);
   expect((await fetch(root+'/manage/units/main/send',{method:'POST',headers})).status).toBe(404);
   const hook=(token:string)=>fetch(root+'/hook/'+t+'/'+u,{method:'POST',headers:{'content-type':'application/json','x-av-evolution-auth':token},body:JSON.stringify(payload())});
   expect((await hook(c.webhookToken)).status).toBe(401);
   x.inboundEnabled.mockReturnValue(true);
   expect((await hook('Z'.repeat(40))).status).toBe(401);
   const accepted=await hook(c.webhookToken);expect(accepted.status).toBe(200);
   expect(await accepted.json()).toEqual({ok:true,accepted:1,duplicates:0});
   expect((await fetch(root+'/manage/units/main/disconnect',{method:'POST',headers})).status).toBe(200);
  }finally{
   await new Promise<void>((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});
  }
 },15000);
});
