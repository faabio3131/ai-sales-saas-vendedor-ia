import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {FirestoreEvolutionStore,EvolutionPairingService} from '../src/channels/evolutionPairing';
import {FirestoreEvolutionAttendanceStore,recoverEvolutionOnly} from '../src/channels/evolutionAttendanceStore';
import {attendanceHash,attendanceIds,type AttendanceJob,type AttendanceAuthorization} from '../src/channels/evolutionAttendance';
import {evolutionInstance,EvolutionV2Client} from '../src/channels/evolutionClient';
import {channelDocId,FirestoreWhatsAppConnectionStore,type WhatsAppConnection} from '../src/channels/whatsappConnections';
import type {BusinessProfileRevision} from '../src/business/model';
import {FirestoreConversationRepository} from '../src/conversations/firestoreRepository';

const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';
if(enabled&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t10'||process.env.NODE_ENV!=='test'))throw Error('EVOLUTION_EMULATOR_UNSAFE');
// Drain all contenders on failure, preserving every terminal rejection.
async function settleConcurrent<T>(phase:string,operations:Promise<T>[]):Promise<T[]>{
 const settled=await Promise.allSettled(operations);
 console.log('FIRESTORE_CONCURRENCY '+JSON.stringify({phase,results:settled.map(r=>r.status==='fulfilled'?{status:r.status}:{status:r.status,code:r.reason?.code??'UNKNOWN',message:String(r.reason?.message??'').slice(0,240)})}));
 const failures=settled.filter((r):r is PromiseRejectedResult=>r.status==='rejected');
 if(failures.length)throw new AggregateError(failures.map(r=>r.reason),'FIRESTORE_CONCURRENT_PHASE_FAILED:'+phase);
 return settled.map(r=>(r as PromiseFulfilledResult<T>).value);
}
describe.skipIf(!enabled)('Evolution real Firestore atomic inbound, CRM and outbound reservation',()=>{
 it('persists one conversation and message under concurrent duplicate webhook delivery, reserves one send',async()=>{
  const db=getFirestore(ensureFirebaseAdminApp());
  const t='evo_test_'+randomUUID().replace(/-/g,'').slice(0,16),u='main';
  const s={tenantId:t,unitId:u},key=channelDocId(t,u);let now=Date.now();const at=new Date(now).toISOString();
  const ownerPhone='5511'+String(Math.floor(100000000+Math.random()*899999999));
  const b=db.collection('merchantEvolutionConnections').doc(key);
  await b.create({...s,instanceName:evolutionInstance(t,u),ownerPhone,status:'CONNECTED',leaseId:'',leaseUntil:0,updatedAt:at});
  await db.collection('evolutionPhoneReservations').doc(attendanceHash(ownerPhone)).create({...s,instanceName:evolutionInstance(t,u),ownerPhone});
  const event={externalMessageId:'fixture_1',sender:'5511999999999',text:'Olá',occurredAt:at};
  if(ownerPhone===event.sender)throw Error('fixture collision');
  const inbound=new FirestoreEvolutionStore(),store=new FirestoreEvolutionAttendanceStore(db);
  const created=await settleConcurrent('duplicate-inbound',Array.from({length:3},()=>inbound.persist(s,event.externalMessageId,event)));
  expect(created.filter(Boolean)).toHaveLength(1);
  const ids=attendanceIds(s,event);
  const row=db.collection('evolutionInboundInbox').doc(ids.id);
  const job=(await row.get()).data() as AttendanceJob;
  expect(job).toMatchObject({...s,...ids,state:'RECEIVED'});
  expect((await db.collection('customers').doc(ids.customerId).get()).data()).toMatchObject({tenantId:t,phone:event.sender,status:'ACTIVE'});
  expect((await db.collection('conversations').doc(ids.conversationId).get()).data()).toMatchObject({tenantId:t,customerId:ids.customerId,handlingMode:'AI'});
  expect((await db.collection('messages').doc(ids.messageId).get()).data()).toMatchObject({tenantId:t,text:event.text,direction:'INBOUND'});
  now=Date.now();
  const results=await settleConcurrent('claim',[store.claim(job,'claim-a',now+10),store.claim(job,'claim-b',now+10)]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const j=results.find(x=>x!==null)!;
  const profile:BusinessProfileRevision={...s,version:1,effectiveFrom:at,createdAt:at,createdBy:'fixture',
   identity:{assistantName:'Fixture',voiceStyle:'PROFESSIONAL'},capabilityRegistry:{vertical:'OTHER',capabilities:[],operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED'},
   policy:{timezone:'America/Sao_Paulo',locale:'pt-BR',memoryRetentionDays:90,personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},facts:[]};
  const auth:AttendanceAuthorization={profile,capabilityVersion:1};
  await Promise.all([
   db.collection('businessProfiles').doc(key).create({...s,latestVersion:1}),
   db.collection('unitCapabilityAssignments').doc(key).create({...s,latestVersion:1}),
   db.collection('subscriptions').doc(t).create({id:t,tenantId:t,status:'ACTIVE',planCode:'BASIC',periodStart:'2020-01-01T00:00:00Z',periodEnd:'2099-01-01T00:00:00Z',createdAt:at,updatedAt:at})
  ]);
  await b.update({reconciliationRequired:true});
  expect(await store.reserve(j,{text:'Olá! Como posso ajudar?',source:'GREETING',profileVersion:1},auth,now+20)).toBe('SUPPRESSED');
  await b.update({reconciliationRequired:false});
  expect(await store.reserve(j,{text:'Olá! Como posso ajudar?',source:'GREETING',profileVersion:1},auth,now+20)).toBe('RESERVED');
  expect(await store.reserve(j,{text:'Olá!',source:'GREETING',profileVersion:1},auth,now+21)).toBe('STALE');
  const concurrent={...event,sender:'5511988888888',externalMessageId:'fixture_concurrent',occurredAt:new Date(now+22).toISOString()};
  expect(await inbound.persist(s,concurrent.externalMessageId,concurrent)).toBe(true);
  const concurrentJob=(await db.collection('evolutionInboundInbox').doc(attendanceIds(s,concurrent).id).get()).data() as AttendanceJob;
  now=Date.now();
  const claimed=await store.claim(concurrentJob,'claim-concurrent',now+23);expect(claimed).not.toBeNull();
  expect(await store.reserve(claimed!,{text:'Olá!',source:'GREETING',profileVersion:1},auth,now+24)).toBe('DEFERRED');
  await store.defer(claimed!,now+25);
  expect((await db.collection('conversations').doc(concurrentJob.conversationId).get()).get('handlingMode')).toBe('AI');
  await store.finish(j,'SENT',now+30,'provider-out-1');
  expect((await row.get()).get('state')).toBe('SENT');
  expect((await db.collection('evolutionAttendanceOutbox').doc(ids.id).get()).data()).toMatchObject({tenantId:t,status:'SENT',externalMessageId:'provider-out-1'});
  expect((await b.get()).get('outboundLeaseId')).toBe('');
  expect(await store.claim(job,'claim-c',now+40)).toBeNull();
  const conversations=new FirestoreConversationRepository();
  const before=(await conversations.findById(t,ids.conversationId))!;
  const newer={...event,externalMessageId:'fixture_newer',occurredAt:event.occurredAt,text:'Nova mensagem no mesmo segundo'};
  expect(await inbound.persist(s,newer.externalMessageId,newer)).toBe(true);
  const newerIds=attendanceIds(s,newer);
  await conversations.update({...before,updatedAt:new Date().toISOString()});
  expect((await conversations.findById(t,ids.conversationId))?.lastInboundMessageId).toBe(newerIds.messageId);
  const latestJob=(await db.collection('evolutionInboundInbox').doc(newerIds.id).get()).data() as AttendanceJob;
  expect(await store.claim(latestJob,'claim-newer',Date.now())).not.toBeNull();
  const second={...event,externalMessageId:'fixture_2',occurredAt:new Date(now+100).toISOString(),text:'PARAR'};
  expect(await inbound.persist(s,second.externalMessageId,second)).toBe(true);
  const secondId=attendanceIds(s,second).id;
  const stop=(await db.collection('evolutionInboundInbox').doc(secondId).get()).data() as AttendanceJob;
  expect(await store.claim(stop,'claim-stop',Date.now()+110)).toBeNull();
  expect((await db.collection('conversations').doc(ids.conversationId).get()).get('handlingMode')).toBe('HUMAN');
  expect((await db.collection('evolutionContactPreferences').doc(attendanceHash(t,u,event.sender)).get()).get('preference')).toBe('OPT_OUT');
  const spoof=await fetch('http://127.0.0.1:8089/v1/projects/demo-atendevende-t10/databases/(default)/documents/evolutionInboundInbox/'+ids.id);
  expect(spoof.status).toBe(403);
 },60000);
 it('preserves Meta exclusivity until verified logout and safely releases the reserved owner',async()=>{
  const db=getFirestore(ensureFirebaseAdminApp()),s={tenantId:'evo_meta_'+randomUUID().replace(/-/g,''),unitId:'main'};
  const binding=db.collection('merchantEvolutionConnections').doc(channelDocId(s.tenantId,s.unitId));
  const ownerPhone='5511'+String(Math.floor(100000000+Math.random()*899999999));
  const phone=db.collection('evolutionPhoneReservations').doc(attendanceHash(ownerPhone));
  const instanceName=evolutionInstance(s.tenantId,s.unitId),at=new Date().toISOString();
  await binding.create({...s,instanceName,ownerPhone,status:'CONNECTED',leaseId:'',leaseUntil:0,updatedAt:at});
  await phone.create({...s,instanceName,ownerPhone});
  const store=new FirestoreEvolutionStore(),meta=new FirestoreWhatsAppConnectionStore();
  const next:WhatsAppConnection={...s,status:'ACTIVE',phoneNumberId:String(Date.now())+'17',wabaId:'123456789',version:1,createdAt:at,updatedAt:at};
  await store.acquire(s,'lease-timeout');
  expect((await binding.get()).get('status')).toBe('CONNECTED');
  await store.finish(s,'lease-timeout');
  await expect(meta.write(next,0)).rejects.toMatchObject({code:'CHANNEL_EVOLUTION_ACTIVE_CONFLICT'});
  const fixtureCredential={...s,instanceName,expectedOwnerPhone:ownerPhone,apiKey:'A'.repeat(40),webhookToken:'B'.repeat(40)};
  const transport=vi.fn<typeof fetch>()
   .mockResolvedValueOnce(new Response('{}',{status:400}))
   .mockResolvedValueOnce(new Response(JSON.stringify({instance:{instanceName,state:'close'}})));
  const client=new EvolutionV2Client('https://evolution-app.atendevendeia.com.br',transport);
  const service=new EvolutionPairingService({store,client,vault:{load:async()=>fixtureCredential},
   authorizeUnit:async()=>{},metaActive:async()=>false,pairingEnabled:()=>true,inboundEnabled:()=>false,
   callback:()=> 'https://app.atendevendeia.com.br/fixture'});
  await expect(service.disconnect({tenantId:s.tenantId,role:'OWNER',userId:'fixture',requestId:'fixture'},s.unitId))
   .rejects.toMatchObject({code:'EVOLUTION_LOGOUT_RECONCILIATION_REQUIRED'});
  expect((await binding.get()).data()).toMatchObject({status:'UNKNOWN',ownerPhone,leaseId:'',leaseUntil:0});
  expect((await phone.get()).data()).toMatchObject({...s,instanceName,ownerPhone});
  await expect(meta.write(next,0)).rejects.toMatchObject({code:'CHANNEL_EVOLUTION_ACTIVE_CONFLICT'});
  // The remote session may be open during reconciliation, but the pause is sticky.
  await store.acquire(s,'lease-reconnect',true,'connect');
  await store.finish(s,'lease-reconnect','CONNECTED',ownerPhone);
  expect((await binding.get()).data()).toMatchObject({status:'CONNECTED',reconciliationRequired:true,ownerPhone});
  const event={externalMessageId:'paused',sender:ownerPhone==='5511999999999'?'5511888888888':'5511999999999',text:'Oi',occurredAt:at};
  await expect(store.persist(s,event.externalMessageId,event)).rejects.toMatchObject({code:'EVOLUTION_SESSION_BUSY'});
  await expect(meta.write(next,0)).rejects.toMatchObject({code:'CHANNEL_EVOLUTION_ACTIVE_CONFLICT'});
  await store.acquire(s,'lease-logout',false,'logout');
  await store.finish(s,'lease-logout','DISCONNECTED');
  expect((await phone.get()).exists).toBe(false);
  expect((await binding.get()).get('ownerPhone')).toBeUndefined();
  expect((await binding.get()).get('reconciliationRequired')).toBeUndefined();
  const before=(await binding.get()).data();
  await expect(store.acquire(s,'stale-logout',false,'logout')).rejects.toMatchObject({code:'EVOLUTION_NO_ACTIVE_BINDING'});
  expect((await binding.get()).data()).toEqual(before);
  const absent={tenantId:s.tenantId,unitId:'absent'};
  await expect(store.acquire(absent,'absent-logout',false,'logout')).rejects.toMatchObject({code:'EVOLUTION_NO_ACTIVE_BINDING'});
  expect(await store.get(absent)).toBeNull();
  await meta.write(next,0);
  expect((await meta.get(s.tenantId,s.unitId))?.status).toBe('ACTIVE');
 },60000);
 it('keeps Meta activation and Evolution acquisition mutually exclusive under a real same-unit race',async()=>{
  const db=getFirestore(ensureFirebaseAdminApp()),meta=new FirestoreWhatsAppConnectionStore(),evo=new FirestoreEvolutionStore();
  for(let rep=1;rep<=3;rep++){
   const s={tenantId:'evo_race_'+randomUUID().replace(/-/g,''),unitId:'main'};
   const at=new Date().toISOString(),lease='race-'+randomUUID();
   const phoneNumberId='1'+BigInt('0x'+randomUUID().replace(/-/g,'').slice(0,16)).toString();
   const initial:WhatsAppConnection={...s,status:'DISABLED',phoneNumberId,wabaId:'123456789',version:1,createdAt:at,updatedAt:at};
   const ref=db.collection('merchantEvolutionConnections').doc(channelDocId(s.tenantId,s.unitId));
   await ref.create({...s,instanceName:evolutionInstance(s.tenantId,s.unitId),status:'DISCONNECTED',leaseId:'',leaseUntil:0,updatedAt:at});
   await meta.write(initial,0);
   const [m,e]=await Promise.allSettled([meta.write({...initial,status:'ACTIVE',version:2},1),evo.acquire(s,lease,true,'connect')]);
   console.log('FIRESTORE_CHANNEL_RACE '+JSON.stringify({rep,meta:m.status,evolution:e.status,metaCode:m.status==='rejected'?m.reason?.code:undefined,evolutionCode:e.status==='rejected'?e.reason?.code:undefined}));
   expect([m,e].filter(r=>r.status==='fulfilled')).toHaveLength(1);
   const afterMeta=await meta.get(s.tenantId,s.unitId),afterEvo=(await ref.get()).data();
   expect((await db.collection('whatsappPhoneReservations').doc(phoneNumberId).get()).data()).toMatchObject({...s,phoneNumberId});
   if(m.status==='fulfilled'){
    expect(e).toMatchObject({status:'rejected',reason:{code:'EVOLUTION_META_ACTIVE_CONFLICT'}});
    expect(afterMeta).toMatchObject({status:'ACTIVE',version:2});
    expect(afterEvo).toMatchObject({status:'DISCONNECTED',leaseId:'',leaseUntil:0});
   }else{
    expect(m).toMatchObject({status:'rejected',reason:{code:'CHANNEL_EVOLUTION_ACTIVE_CONFLICT'}});
    expect(e.status).toBe('fulfilled');
    expect(afterMeta).toMatchObject({status:'DISABLED',version:1});
    expect(afterEvo).toMatchObject({status:'UNKNOWN',leaseId:lease});
   }
   expect(afterEvo?.ownerPhone).toBeUndefined();
  }
 },60000);
 it('allows simultaneous Meta and Evolution lifecycle changes on distinct units',async()=>{
  const db=getFirestore(ensureFirebaseAdminApp()),meta=new FirestoreWhatsAppConnectionStore(),evo=new FirestoreEvolutionStore();
  const tenantId='evo_units_'+randomUUID().replace(/-/g,''),s={tenantId,unitId:'evolution'},m={tenantId,unitId:'meta'};
  const at=new Date().toISOString(),lease='units-'+randomUUID();
  const phoneNumberId='1'+BigInt('0x'+randomUUID().replace(/-/g,'').slice(0,16)).toString();
  const next:WhatsAppConnection={...m,status:'ACTIVE',phoneNumberId,wabaId:'123456789',version:1,createdAt:at,updatedAt:at};
  await settleConcurrent('distinct-units',[meta.write(next,0).then(()=>true),evo.acquire(s,lease,true,'connect')]);
  expect(await meta.get(m.tenantId,m.unitId)).toMatchObject({status:'ACTIVE',version:1});
  expect(await evo.get(s)).toMatchObject({status:'UNKNOWN',leaseId:lease});
  expect(await meta.get(s.tenantId,s.unitId)).toBeNull();
  expect(await evo.get(m)).toBeNull();
  expect((await db.collection('whatsappPhoneReservations').doc(phoneNumberId).get()).data()).toMatchObject({...m,phoneNumberId});
 },60000);
 it('finds expired leases behind active rows and quarantines only malformed jobs',async()=>{
  const db=getFirestore(ensureFirebaseAdminApp()),now=Date.now(),s={tenantId:'evo_recover_'+randomUUID().replace(/-/g,''),unitId:'main'};
  const inbox=db.collection('evolutionInboundInbox');
  const event={externalMessageId:'expired',sender:'5511999999999',text:'Oi',occurredAt:new Date(now).toISOString()};
  const valid={...s,...event,...attendanceIds(s,event),receivedAt:event.occurredAt,state:'PROCESSING',claimId:'expired',leaseUntil:now-1000};
  const invalid=inbox.doc('000-invalid-'+s.tenantId);
  await Promise.all([
   ...Array.from({length:15},(_,i)=>inbox.doc('000-active-'+s.tenantId+'-'+i).create({state:'PROCESSING',leaseUntil:now+3600000})),
   inbox.doc(valid.id).create(valid),invalid.create({state:'PROCESSING',leaseUntil:now-2000})
  ]);
  const store=new FirestoreEvolutionAttendanceStore(db);
  await store.recover(now,10);
  expect((await inbox.doc(valid.id).get()).get('state')).toBe('RECEIVED');
  expect((await inbox.doc(valid.id).get()).get('nextAttemptAt')).toBe(now+3000);
  expect((await invalid.get()).get('state')).toBe('QUARANTINED');
 },60000);
 it('recovers only expired RESERVED while all traffic flags are off; never creates an outbound message',async()=>{
  const db=getFirestore(ensureFirebaseAdminApp()),now=Date.now(),at=new Date(now).toISOString();
  const project='demo-atendevende-t10';
  const env={...process.env,EVOLUTION_PAIRING_ENABLED:'false',EVOLUTION_INBOUND_ENABLED:'false',
   EVOLUTION_ATTENDANCE_ENABLED:'false',ATENDEVENDE_PILOT_LIVE_ENABLED:'false',ATENDEVENDE_PILOT_GO_LIVE_APPROVED:'false'};
  const mk=async(expired:boolean,corrupt=false)=>{
   const s={tenantId:'evo_reserved_'+randomUUID().replace(/-/g,''),unitId:'main'};
   const event={externalMessageId:'reserved',sender:'5511999999999',text:'Oi',occurredAt:at};
   const j:AttendanceJob={...s,...event,...attendanceIds(s,event),receivedAt:at,state:'RESERVED',
    claimId:'claim-'+randomUUID(),leaseUntil:now+(expired?(corrupt?-10000:-1000):3600000)};
   const row=db.collection('evolutionInboundInbox').doc(j.id),out=db.collection('evolutionAttendanceOutbox').doc(j.id),
    binding=db.collection('merchantEvolutionConnections').doc(channelDocId(s.tenantId,s.unitId)),
    conv=db.collection('conversations').doc(j.conversationId);
   await Promise.all([row.create(j),out.create({...s,jobId:j.id,claimId:j.claimId,
    conversationId:j.conversationId,customerId:j.customerId,recipient:j.sender,text:'Resposta fixture',
    payloadHash:attendanceHash(j.id,j.sender,'Resposta fixture'),status:'RESERVED',createdAt:at}),
    binding.create({...s,instanceName:j.instanceName,status:'CONNECTED',leaseId:'',leaseUntil:0,
     outboundLeaseId:j.claimId,outboundLeaseUntil:j.leaseUntil,updatedAt:at}),
    conv.create({id:j.conversationId,tenantId:s.tenantId,customerId:j.customerId,handlingMode:'AI',status:'OPEN',lastMessageAt:at})]);
   if(corrupt)await out.delete(); // fixture only: simulate missing durable reservation
   return {j,row,out,binding,conv};
  };
  const expired=await mk(true),active=await mk(false);
  const corrupt=await Promise.all(Array.from({length:10},()=>mk(true,true)));
  await expect(recoverEvolutionOnly('different-project',env,now)).rejects.toMatchObject({code:'EVOLUTION_RECOVERY_SCOPE_OR_FLAGS_INVALID'});
  for(const flag of ['EVOLUTION_PAIRING_ENABLED','EVOLUTION_INBOUND_ENABLED','EVOLUTION_ATTENDANCE_ENABLED','ATENDEVENDE_PILOT_LIVE_ENABLED','ATENDEVENDE_PILOT_GO_LIVE_APPROVED']){
   for(const value of ['true',undefined])await expect(recoverEvolutionOnly(project,{...env,[flag]:value},now)).rejects.toMatchObject({code:'EVOLUTION_RECOVERY_SCOPE_OR_FLAGS_INVALID'});
  }
  await expect(recoverEvolutionOnly(project,{...env,NODE_ENV:'development'},now)).rejects.toMatchObject({code:'EVOLUTION_RECOVERY_SCOPE_OR_FLAGS_INVALID'});
  expect((await expired.row.get()).get('state')).toBe('RESERVED');
  await settleConcurrent('reserved-recovery',[recoverEvolutionOnly(project,env,now),recoverEvolutionOnly(project,env,now)]);
  for(const x of corrupt){
   expect((await x.row.get()).data()).toMatchObject({state:'QUARANTINED',quarantineReason:'RECOVERY_OUTBOX_CONFLICT'});
   expect((await x.binding.get()).get('outboundLeaseId')).toBe(x.j.claimId);
   expect((await x.out.get()).exists).toBe(false);
  }
  expect((await expired.row.get()).data()).toMatchObject({state:'UNKNOWN',leaseUntil:0});
  expect((await expired.out.get()).get('status')).toBe('UNKNOWN');
  expect((await expired.out.get()).get('externalMessageId')).toBeUndefined();
  expect((await expired.binding.get()).data()).toMatchObject({outboundLeaseId:'',outboundLeaseUntil:0,status:'CONNECTED'});
  expect((await expired.conv.get()).get('handlingMode')).toBe('HANDOFF');
  expect((await active.row.get()).get('state')).toBe('RESERVED');
  expect((await active.out.get()).get('status')).toBe('RESERVED');
  expect((await active.binding.get()).get('outboundLeaseId')).toBe(active.j.claimId);
  const store=new FirestoreEvolutionAttendanceStore(db);
  expect(await store.claim(expired.j,'no-retry',now+1)).toBeNull();
  await recoverEvolutionOnly(project,env,now+1);
  expect((await expired.out.get()).get('status')).toBe('UNKNOWN');
  expect((await db.collection('messages').where('tenantId','==',expired.j.tenantId).get()).empty).toBe(true);
  expect((await db.collection('messages').where('tenantId','==',active.j.tenantId).get()).empty).toBe(true);
 },60000);
});
