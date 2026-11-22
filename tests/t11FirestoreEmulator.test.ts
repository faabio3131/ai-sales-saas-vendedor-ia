import {describe,it,expect,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {FirestoreScheduleRepository} from '../src/scheduling/firestoreRepository';
import {FirestoreBusinessProfileRepository} from '../src/business/firestoreRepository';
import {FirestoreCapabilityRepository} from '../src/capabilities/firestoreRepository';
import {BusinessProfileService} from '../src/business/service';
import {CapabilityRegistryService} from '../src/capabilities/service';
import {SchedulingService} from '../src/scheduling/service';
import {FirestoreCustomerRepository} from '../src/customers/firestoreRepository';
import {FirestoreWhatsAppInbox} from '../src/channels/whatsappWebhooks';
import {FirestoreBookingIdentityRepository,FirestoreBookingConsentRepository} from '../src/bookingPacks/contactTrust';
import {PackNoticeService} from '../src/bookingPacks/notices';
import type {WhatsAppConnection} from '../src/channels/whatsappConnections';
import type {NormalizedInboundMessage} from '../src/channels/contracts';
import type {CapabilityId,CapabilityTemplateId} from '../src/capabilities/model';
import {actor,scope} from './t10ScheduleSupport';
import {packConfig,packInput,PHONE} from './t11PackSupport';
import type {BookingPack} from '../src/scheduling/model';
const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';
if(enabled&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t10'||process.env.NODE_ENV!=='test'))throw Error('Unsafe emulator config');
const k=(...s:string[])=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
async function provision(kind:BookingPack,allowPack=true){
 const tenant='t11_'+randomUUID().replace(/-/g,'').slice(0,20),unit='main',t=actor(tenant),s=scope(tenant,unit);
 let now=Date.now();
 const db=getFirestore(ensureFirebaseAdminApp()),store=new FirestoreScheduleRepository(),customers=new FirestoreCustomerRepository();
 const customerId='customer-'+tenant;
 await customers.create({id:customerId,tenantId:tenant,name:'Fixture',status:'ACTIVE',phone:PHONE,
  externalIdentities:[],createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()});
 const vertical=kind==='AESTHETICS_ADMIN'?'HEALTH_SERVICE':kind==='PROFESSIONAL_SERVICES'?'SERVICES':'BEAUTY';
 const template:CapabilityTemplateId=vertical==='HEALTH_SERVICE'?'HEALTH_ADMIN_STD':vertical==='SERVICES'?'SERVICES_STD':'BEAUTY_STD';
 const enabledCapabilities:CapabilityId[]=['CORE_KNOWLEDGE','SERVICE_CATALOG','SCHEDULING'];
 if(allowPack){if(vertical==='BEAUTY')enabledCapabilities.push('BEAUTY_SERVICES','BEAUTY_BOOKING');
  else enabledCapabilities.push(vertical==='HEALTH_SERVICE'?'HEALTH_ADMIN':'SERVICE_BOOKING');}
 const profiles=new FirestoreBusinessProfileRepository();
 await new BusinessProfileService(profiles).publish(t,unit,{expectedVersion:0,effectiveFrom:'2026-01-01T00:00:00.000Z',
  identity:{assistantName:'Fixture',voiceStyle:'FRIENDLY'},
  capabilityRegistry:{vertical,capabilities:[],operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED'},
  policy:{locale:'pt-BR',timezone:'America/Sao_Paulo',memoryRetentionDays:90,personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},facts:[]});
 const capabilities=new CapabilityRegistryService(new FirestoreCapabilityRepository(),profiles,()=>new Date(now));
 await capabilities.publish(t,unit,{expectedVersion:0,templateId:template,templateVersion:1,enabledCapabilities,reason:'Certificação T11 emulador'});
 const service=new SchedulingService(store,customers,()=>new Date(now));
 const day=new Date(now+3*86400000).toISOString().slice(0,10);
 if(allowPack)await service.configure(t,unit,packConfig(kind));
 const identities=new FirestoreBookingIdentityRepository(),consent=new FirestoreBookingConsentRepository();
 const sender={send:vi.fn(async()=>({externalMessageId:'wamid.emulator_message',duplicate:false}))};
 const notice=new PackNoticeService(store,service,customers,identities,consent,{hasRecentVerifiedInbound:async()=>true},sender,()=>{});
 const conn:WhatsAppConnection={tenantId:tenant,unitId:unit,phoneNumberId:'1234567890',wabaId:'9876543210',
  status:'ACTIVE',credentialRef:'fixture',version:1,createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString()};
 const message=(text:string,eventId:string,occurredAt=new Date(now).toISOString()):NormalizedInboundMessage=>({
  tenantId:tenant,channel:'WHATSAPP',sender:PHONE,externalAccountRef:conn.phoneNumberId,externalMessageId:eventId,type:'TEXT',text,occurredAt});
 return {tenant,unit,t,s,db,store,service,capabilities,template,day,customerId,notice,sender,conn,message,consent,identities,
  time:(ms:number)=>{now=ms;},now:()=>now};
}
describe.skipIf(!enabled)('T11 real Firestore pack grants, consent ingestion and outbox fencing',()=>{
 it('signed inbox persistence binds explicit opt-in to actual booking/customer/tenant; concurrent workers send once; browser cannot write consent',async()=>{
  const h=await provision('SALON'),b=await h.service.reserve(h.t,h.unit,packInput(h.tenant,h.day+'T13:00:00Z'));
  const c=await h.service.confirm(h.t,h.unit,b.id,{expectedVersion:1,idempotencyKey:'confirm'});
  const inbox=new FirestoreWhatsAppInbox(),opt=h.message('AUTORIZO AVISOS DE AGENDAMENTO '+b.id,'wamid.optin_1');
  // Direct invocation stands for the already HMAC-verified internal inbox boundary.
  expect(await inbox.persist(h.conn,opt)).toBe(true);
  expect(await inbox.persist(h.conn,opt)).toBe(false);
  expect(await h.consent.get(h.tenant,h.unit,h.customerId)).toMatchObject({preference:'OPT_IN',recipient:PHONE});
  expect(await h.identities.get(h.tenant,h.customerId,'WHATSAPP',h.unit)).toMatchObject({recipient:PHONE});
  await Promise.all([h.notice.cycle(h.s),h.notice.cycle(h.s),h.notice.processOne(h.s,c.id)]);
  expect(h.sender.send).toHaveBeenCalledTimes(1);
  const row=await h.service.get(h.t,h.unit,b.id);
  expect(row.notices?.[0].state).toBe('ACCEPTED_BY_PROVIDER');
  const ref=h.db.collection('schedulingUnits').doc(k(h.tenant,h.unit)).collection('bookings').doc(b.id);
  expect((await ref.collection('versions').get()).size).toBe(4);
  const url='http://127.0.0.1:8089/v1/projects/demo-atendevende-t10/databases/(default)/documents/bookingContactConsents/'+k(h.tenant,h.unit,PHONE);
  expect((await fetch(url)).status).toBe(403);
  expect((await fetch(url,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({fields:{preference:{stringValue:'OPT_IN'}}})})).status).toBe(403);
 },60000);
 it('rejects wrong booking scope and out-of-order opt-in after opt-out, no outbound contact after revocation',async()=>{
  const a=await provision('BARBERSHOP'),b=await provision('AESTHETICS_ADMIN');
  const held=await a.service.reserve(a.t,a.unit,packInput(a.tenant,a.day+'T13:00:00Z'));
  const inbox=new FirestoreWhatsAppInbox();
  await inbox.persist(b.conn,b.message('AUTORIZO AVISOS DE AGENDAMENTO '+held.id,'wamid.foreign'));
  expect(await b.consent.get(b.tenant,b.unit,b.customerId)).toBeNull();
  const opt=a.message('AUTORIZO AVISOS DE AGENDAMENTO '+held.id,'wamid.legit');
  await inbox.persist(a.conn,opt);
  const out=a.message('CANCELAR AVISOS DE AGENDAMENTO','wamid.optout',new Date(a.now()+1000).toISOString());
  await inbox.persist(a.conn,out);
  await inbox.persist(a.conn,{...opt,externalMessageId:'wamid.replay_old'});
  expect(await a.consent.get(a.tenant,a.unit,a.customerId)).toMatchObject({preference:'OPT_OUT'});
  const c=await a.service.confirm(a.t,a.unit,held.id,{expectedVersion:1,idempotencyKey:'confirm'});
  expect(await a.notice.processOne(a.s,c.id)).toBe('BLOCKED');expect(a.sender.send).not.toHaveBeenCalled();
 },60000);
 it('pack capability authorization is transactional, active booking blocks retirement; no-show and explicit reconfiguration preserve history',async()=>{
  const denied=await provision('SALON',false);
  await expect(denied.service.configure(denied.t,denied.unit,packConfig('SALON'))).rejects.toMatchObject({code:'PACK_CAPABILITY_REQUIRED'});
  const h=await provision('AESTHETICS_ADMIN'),b=await h.service.reserve(h.t,h.unit,packInput(h.tenant,h.day+'T13:00:00Z'));
  const retire={expectedVersion:1,templateId:h.template,templateVersion:1 as const,enabledCapabilities:['CORE_KNOWLEDGE','SERVICE_CATALOG','SCHEDULING'] as CapabilityId[],reason:'Desativação teste'};
  await expect(h.capabilities.publish(h.t,h.unit,retire)).rejects.toMatchObject({code:'CAPABILITY_ACTIVE_BOOKINGS_BLOCK_CHANGE'});
  const c=await h.service.confirm(h.t,h.unit,b.id,{expectedVersion:1,idempotencyKey:'confirmation'});
  h.time(c.startMs+15*60000);
  const absent=await h.service.noShow(h.t,h.unit,b.id,{expectedVersion:c.version,idempotencyKey:'no-show'});
  expect(absent.status).toBe('NO_SHOW');
  expect((await h.db.collection('schedulingTenants').doc(k(h.tenant)).collection('occupancy').doc(b.id).get()).exists).toBe(false);
  await h.capabilities.publish(h.t,h.unit,retire);
  await expect(h.service.availability(h.t,h.unit,{serviceId:'service-a',professionalId:'pro-a',date:h.day})).rejects.toMatchObject({code:'PACK_CAPABILITY_REQUIRED'});
 },60000);
});
