import {describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {FirestoreScheduleRepository} from '../src/scheduling/firestoreRepository';
import {FirestoreBusinessProfileRepository} from '../src/business/firestoreRepository';
import {FirestoreCapabilityRepository} from '../src/capabilities/firestoreRepository';
import {BusinessProfileService} from '../src/business/service';
import {CapabilityRegistryService} from '../src/capabilities/service';
import {SchedulingService} from '../src/scheduling/service';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {actor,config,input,BASE,customerRepo} from './t10ScheduleSupport';
import {MINUTE} from '../src/scheduling/rules';
const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';
if(enabled&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t10'||process.env.NODE_ENV!=='test')){
 throw Error('T10 emulator safety configuration invalid');
}
const scopedKey=(...p:string[])=>createHash('sha256').update(JSON.stringify(p)).digest('hex');
async function provision(tenant:string,u:string,now=BASE){
 const ctx=actor(tenant),profiles=new FirestoreBusinessProfileRepository();
 const profile=new BusinessProfileService(profiles);
 await profile.publish(ctx,u,{expectedVersion:0,effectiveFrom:'2026-01-01T00:00:00.000Z',
  identity:{assistantName:'Teste isolado',voiceStyle:'FRIENDLY'},
  capabilityRegistry:{vertical:'SERVICES',capabilities:[],operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED'},
  policy:{locale:'pt-BR',timezone:'America/Sao_Paulo',memoryRetentionDays:90,
   personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},facts:[]});
 const capabilities=new CapabilityRegistryService(new FirestoreCapabilityRepository(),profiles,()=>new Date(now));
 await capabilities.publish(ctx,u,{expectedVersion:0,templateId:'SERVICES_STD',templateVersion:1,
  enabledCapabilities:['CORE_KNOWLEDGE','SERVICE_CATALOG','SCHEDULING'],reason:'Prova emulador T10'});
 const s=new SchedulingService(new FirestoreScheduleRepository(),customerRepo,()=>new Date(now));
 await s.configure(ctx,u,config());
 return {ctx,s,capabilities,profiles};
}
function tenant(){return 't10_'+randomUUID().replace(/-/g,'').slice(0,20);}
describe.skipIf(!enabled)('T10 Firestore emulator transaction and ledger acceptance',()=>{
 it('8 independent Firestore transactions compete for the same professional/room; exactly one persisted hold',async()=>{
  const t=tenant(),{s,ctx}=await provision(t,'main');
  const results=await Promise.allSettled(Array.from({length:8},(_,i)=>
    s.reserve(ctx,'main',input(t,'2026-11-23T13:00:00Z','r'+i))));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const rejects=results.filter(r=>r.status==='rejected');
  expect(rejects).toHaveLength(7);
  for(const r of rejects)expect(r.reason.code).toBe('SCHEDULE_SLOT_UNAVAILABLE');
  const records=await s.list(ctx,'main',{startAt:'2026-11-23T00:00:00Z',endAt:'2026-11-24T00:00:00Z'});
  expect(records).toHaveLength(1);
  const b=records[0];
  const confirmed=await s.confirm(ctx,'main',b.id,{expectedVersion:b.version,idempotencyKey:'confirm'});
  expect(confirmed.status).toBe('CONFIRMED');
  const db=getFirestore(ensureFirebaseAdminApp()),unit=db.collection('schedulingUnits').doc(scopedKey(t,'main'));
  const versions=await unit.collection('bookings').doc(b.id).collection('versions').get();
  expect(versions.size).toBe(2);
  expect((await db.collection('schedulingTenants').doc(scopedKey(t)).collection('occupancy').doc(b.id).get()).get('status')).toBe('CONFIRMED');
 },60000);
 it('real storage locks shared resources across units, strips customer data from occupancy, and isolates other tenants',async()=>{
  const t=tenant(),other=tenant(),a=await provision(t,'main'),b=await provision(t,'second'),c=await provision(other,'main');
  const held=await a.s.reserve(a.ctx,'main',input(t));
  await expect(b.s.reserve(b.ctx,'second',input(t,'2026-11-23T13:00:00Z','other','pro-b')))
   .rejects.toMatchObject({code:'SCHEDULE_SLOT_UNAVAILABLE'});
  await expect(c.s.reserve(c.ctx,'main',input(other))).resolves.toMatchObject({tenantId:other});
  await expect(c.s.get(c.ctx,'main',held.id)).rejects.toMatchObject({code:'SCHEDULE_BOOKING_NOT_FOUND'});
  const lock=(await getFirestore(ensureFirebaseAdminApp()).collection('schedulingTenants').doc(scopedKey(t))
    .collection('occupancy').doc(held.id).get()).data()!;
  expect(lock.customerId).toBeUndefined();expect(lock.deposit).toBeUndefined();
 },60000);
 it('capability removal blocked while active; cancellation and rollback release locks and preserve revision history',async()=>{
  const t=tenant(),{s,ctx,capabilities}=await provision(t,'main');
  const b=await s.reserve(ctx,'main',input(t,'2026-12-01T13:00:00Z','future'));
  const remove={expectedVersion:1,templateId:'SERVICES_STD' as const,templateVersion:1 as const,
    enabledCapabilities:['CORE_KNOWLEDGE' as const],reason:'Desativação em teste'};
  await expect(capabilities.publish(ctx,'main',remove)).rejects.toMatchObject({code:'CAPABILITY_ACTIVE_BOOKINGS_BLOCK_CHANGE'});
  await s.cancel(ctx,'main',b.id,{expectedVersion:1,idempotencyKey:'cancel',reason:'Teste de cancelamento'});
  const updated=await capabilities.publish(ctx,'main',remove);
  expect(updated.enabledCapabilities).toEqual(['CORE_KNOWLEDGE']);
  await expect(s.availability(ctx,'main',{date:'2026-12-01',professionalId:'pro-a',serviceId:'service-a'}))
   .rejects.toMatchObject({code:'SCHEDULE_CAPABILITY_REQUIRED'});
  expect((await s.get(ctx,'main',b.id)).status).toBe('CANCELLED');
 },60000);
 it('worker due index expires long-horizon holds, then replays are no-ops; immutable configuration versions',async()=>{
  const t=tenant(),{s,ctx}=await provision(t,'main');
  const b=await s.reserve(ctx,'main',input(t,'2027-01-01T13:00:00Z','future'));
  const worker=new SchedulingService(new FirestoreScheduleRepository(),customerRepo,()=>new Date(BASE+16*MINUTE));
  expect(await worker.maintainDue({tenantId:t,unitId:'main'})).toMatchObject({expired:1,ready:0});
  expect(await worker.maintainDue({tenantId:t,unitId:'main'})).toMatchObject({expired:0,ready:0});
  expect((await worker.get(ctx,'main',b.id)).status).toBe('EXPIRED');
  const c=await worker.configure(ctx,'main',{...config(),expectedVersion:1});
  expect(c.version).toBe(2);
  const db=getFirestore(ensureFirebaseAdminApp());
  const revisions=await db.collection('schedulingUnits').doc(scopedKey(t,'main')).collection('configVersions').get();
  expect(revisions.size).toBe(2);
 },60000);
});
