import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {FirestoreEvolutionStore} from '../src/channels/evolutionPairing';
import {FirestoreEvolutionAttendanceStore} from '../src/channels/evolutionAttendanceStore';
import {attendanceHash,attendanceIds,type AttendanceJob,type AttendanceAuthorization} from '../src/channels/evolutionAttendance';
import {evolutionInstance} from '../src/channels/evolutionClient';
import {channelDocId} from '../src/channels/whatsappConnections';
import type {BusinessProfileRevision} from '../src/business/model';

const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';
if(enabled&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t10'||process.env.NODE_ENV!=='test'))throw Error('EVOLUTION_EMULATOR_UNSAFE');
describe.skipIf(!enabled)('Evolution real Firestore atomic inbound, CRM and outbound reservation',()=>{
 it('persists one conversation and message under concurrent duplicate webhook delivery, reserves one send',async()=>{
  const db=getFirestore(ensureFirebaseAdminApp());
  const t='evo_test_'+randomUUID().replace(/-/g,'').slice(0,16),u='main';
  const s={tenantId:t,unitId:u},key=channelDocId(t,u),now=Date.now(),at=new Date(now).toISOString();
  const ownerPhone='5511'+String(Math.floor(100000000+Math.random()*899999999));
  const b=db.collection('merchantEvolutionConnections').doc(key);
  await b.create({...s,instanceName:evolutionInstance(t,u),ownerPhone,status:'CONNECTED',leaseId:'',leaseUntil:0,updatedAt:at});
  await db.collection('evolutionPhoneReservations').doc(attendanceHash(ownerPhone)).create({...s,instanceName:evolutionInstance(t,u),ownerPhone});
  const event={externalMessageId:'fixture_1',sender:'5511999999999',text:'Olá',occurredAt:at};
  if(ownerPhone===event.sender)throw Error('fixture collision');
  const inbound=new FirestoreEvolutionStore(),store=new FirestoreEvolutionAttendanceStore(db);
  const created=await Promise.all(Array.from({length:3},()=>inbound.persist(s,event.externalMessageId,event)));
  expect(created.filter(Boolean)).toHaveLength(1);
  const ids=attendanceIds(s,event);
  const row=db.collection('evolutionInboundInbox').doc(ids.id);
  const job=(await row.get()).data() as AttendanceJob;
  expect(job).toMatchObject({...s,...ids,state:'RECEIVED'});
  expect((await db.collection('customers').doc(ids.customerId).get()).data()).toMatchObject({tenantId:t,phone:event.sender,status:'ACTIVE'});
  expect((await db.collection('conversations').doc(ids.conversationId).get()).data()).toMatchObject({tenantId:t,customerId:ids.customerId,handlingMode:'AI'});
  expect((await db.collection('messages').doc(ids.messageId).get()).data()).toMatchObject({tenantId:t,text:event.text,direction:'INBOUND'});
  const results=await Promise.all([store.claim(job,'claim-a',now+10),store.claim(job,'claim-b',now+10)]);
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
  expect(await store.reserve(j,{text:'Olá! Como posso ajudar?',source:'GREETING',profileVersion:1},auth,now+20)).toBe('RESERVED');
  expect(await store.reserve(j,{text:'Olá!',source:'GREETING',profileVersion:1},auth,now+21)).toBe('STALE');
  const concurrent={...event,sender:'5511988888888',externalMessageId:'fixture_concurrent',occurredAt:new Date(now+22).toISOString()};
  expect(await inbound.persist(s,concurrent.externalMessageId,concurrent)).toBe(true);
  const concurrentJob=(await db.collection('evolutionInboundInbox').doc(attendanceIds(s,concurrent).id).get()).data() as AttendanceJob;
  const claimed=await store.claim(concurrentJob,'claim-concurrent',now+23);expect(claimed).not.toBeNull();
  expect(await store.reserve(claimed!,{text:'Olá!',source:'GREETING',profileVersion:1},auth,now+24)).toBe('DEFERRED');
  await store.defer(claimed!,now+25);
  expect((await db.collection('conversations').doc(concurrentJob.conversationId).get()).get('handlingMode')).toBe('AI');
  await store.finish(j,'SENT',now+30,'provider-out-1');
  expect((await row.get()).get('state')).toBe('SENT');
  expect((await db.collection('evolutionAttendanceOutbox').doc(ids.id).get()).data()).toMatchObject({tenantId:t,status:'SENT',externalMessageId:'provider-out-1'});
  expect((await b.get()).get('outboundLeaseId')).toBe('');
  expect(await store.claim(job,'claim-c',now+40)).toBeNull();
  const second={...event,externalMessageId:'fixture_2',occurredAt:new Date(now+100).toISOString(),text:'PARAR'};
  expect(await inbound.persist(s,second.externalMessageId,second)).toBe(true);
  const secondId=attendanceIds(s,second).id;
  const stop=(await db.collection('evolutionInboundInbox').doc(secondId).get()).data() as AttendanceJob;
  expect(await store.claim(stop,'claim-stop',now+110)).toBeNull();
  expect((await db.collection('conversations').doc(ids.conversationId).get()).get('handlingMode')).toBe('HUMAN');
  expect((await db.collection('evolutionContactPreferences').doc(attendanceHash(t,u,event.sender)).get()).get('preference')).toBe('OPT_OUT');
  const spoof=await fetch('http://127.0.0.1:8089/v1/projects/demo-atendevende-t10/databases/(default)/documents/evolutionInboundInbox/'+ids.id);
  expect(spoof.status).toBe(403);
 },60000);
});
