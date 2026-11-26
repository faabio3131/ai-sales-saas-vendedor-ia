import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createEvolutionAttendanceRuntime} from '../src/channels/evolutionAttendanceRuntime';
import {FirestoreEvolutionAttendanceStore} from '../src/channels/evolutionAttendanceStore';
import {FirestoreBusinessProfileRepository} from '../src/business/firestoreRepository';
import {CapabilityRegistryService} from '../src/capabilities/service';
import {FeatureEntitlementService} from '../src/plans/service';
import {FirestoreWhatsAppConnectionStore,channelDocId} from '../src/channels/whatsappConnections';
import {EvolutionV2Client,GoogleEvolutionVault,evolutionInstance} from '../src/channels/evolutionClient';
import {attendanceHash,attendanceIds,type AttendanceJob} from '../src/channels/evolutionAttendance';
import type {CapabilityId} from '../src/capabilities/model';
import type {BusinessProfileRevision} from '../src/business/model';
const fake=vi.hoisted(()=>({docs:new Map<string,Record<string,unknown>>(),reads:vi.fn()}));
vi.mock('firebase-admin/firestore',async importOriginal=>{
 const real=await importOriginal<typeof import('firebase-admin/firestore')>();
 return {...real,getFirestore:()=>({collection:(name:string)=>({doc:(id:string)=>({
  get:async()=>{fake.reads(name,id);const row=fake.docs.get(name+'/'+id);return {get:(key:string)=>row?.[key]};}
 })})})};
});
vi.mock('../src/infrastructure/firebaseAdmin',async importOriginal=>{
 const real=await importOriginal<typeof import('../src/infrastructure/firebaseAdmin')>();
 return {...real,ensureFirebaseAdminApp:()=>({})};
});
const s={tenantId:'fixture-tenant',unitId:'main'},owner='5511987654321';
const key='merchantEvolutionConnections/'+channelDocId(s.tenantId,s.unitId);
const env:NodeJS.ProcessEnv={NODE_ENV:'production',EVOLUTION_PAIRING_ENABLED:'true',
 EVOLUTION_INBOUND_ENABLED:'true',EVOLUTION_ATTENDANCE_ENABLED:'true',
 ATENDEVENDE_PILOT_LIVE_ENABLED:'true',ATENDEVENDE_PILOT_GO_LIVE_APPROVED:'true',
 ATENDEVENDE_PILOT_ALLOWED_UNITS:JSON.stringify({[s.tenantId]:{[s.unitId]:['WHATSAPP_OUTBOUND']}}),
 PUBLIC_APP_URL:'https://app.atendevendeia.com.br',EVOLUTION_API_ORIGIN:'https://evolution-app.atendevendeia.com.br'};
function fixture(expiredFence=false){
 const at=new Date().toISOString(),event={externalMessageId:'fixture-in',sender:'5511999999999',text:'Oi',occurredAt:at};
 const job:AttendanceJob={...s,...event,...attendanceIds(s,event),receivedAt:at,state:'RECEIVED'};
 const profile:BusinessProfileRevision={...s,version:1,effectiveFrom:at,createdAt:at,createdBy:'fixture',
  identity:{assistantName:'Fixture',voiceStyle:'PROFESSIONAL'},capabilityRegistry:{vertical:'OTHER',capabilities:[],operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED'},
  policy:{timezone:'America/Sao_Paulo',locale:'pt-BR',memoryRetentionDays:90,personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},facts:[]};
 const cred={...s,instanceName:evolutionInstance(s.tenantId,s.unitId),apiKey:'A'.repeat(40),webhookToken:'B'.repeat(40),expectedOwnerPhone:owner};
 fake.docs.set(key,{...s,instanceName:cred.instanceName,status:'CONNECTED',ownerPhone:owner,leaseUntil:0,outboundLeaseId:''});
 fake.docs.set('evolutionPhoneReservations/'+attendanceHash(owner),{...s,instanceName:cred.instanceName,ownerPhone:owner});
 const store=FirestoreEvolutionAttendanceStore.prototype;
 const recover=vi.spyOn(store,'recover').mockResolvedValue(0);
 const pending=vi.spyOn(store,'pending').mockResolvedValue([job]);
 vi.spyOn(store,'claim').mockImplementation(async(j,claimId,now)=>({...j,claimId,leaseUntil:now+120000,state:'PROCESSING'}));
 vi.spyOn(store,'reserve').mockImplementation(async(j,reply,_auth,now)=>{
  fake.docs.set(key,{...fake.docs.get(key),outboundLeaseId:j.claimId,outboundLeaseUntil:now+(expiredFence?-1:60000)});
  fake.docs.set('evolutionAttendanceOutbox/'+j.id,{...s,status:'RESERVED',claimId:j.claimId,recipient:j.sender,payloadHash:attendanceHash(j.id,j.sender,reply.text)});
  return 'RESERVED';
 });
 const finish=vi.spyOn(store,'finish').mockResolvedValue(undefined);
 vi.spyOn(store,'defer').mockResolvedValue(undefined);
 vi.spyOn(FirestoreBusinessProfileRepository.prototype,'effective').mockResolvedValue(profile);
 vi.spyOn(CapabilityRegistryService.prototype,'resolve').mockImplementation(async(ctx,unitId,capability)=>({tenantId:ctx.tenantId,unitId,capability:capability as CapabilityId,authorized:true,status:'ALLOWED_INTERNAL',assignmentVersion:1,commercialGoLiveAuthorized:false}));
 const plan=vi.spyOn(FeatureEntitlementService.prototype,'canUse').mockResolvedValue(true);
 vi.spyOn(FirestoreWhatsAppConnectionStore.prototype,'get').mockResolvedValue(null);
 vi.spyOn(GoogleEvolutionVault.prototype,'load').mockResolvedValue(cred);
 vi.spyOn(EvolutionV2Client.prototype,'state').mockResolvedValue('open');
 vi.spyOn(EvolutionV2Client.prototype,'ownerPhone').mockResolvedValue(owner);
 vi.spyOn(EvolutionV2Client.prototype,'verifyWebhook').mockResolvedValue(undefined);
 const send=vi.spyOn(EvolutionV2Client.prototype,'sendText').mockResolvedValue('fixture-out');
 return {recover,pending,finish,plan,send};
}
beforeEach(()=>{fake.docs.clear();fake.reads.mockClear();});
afterEach(()=>vi.restoreAllMocks());
describe('Evolution composed runtime (isolated ports)',()=>{
 it('never reads jobs or sends when any commercial flag is disabled',async()=>{
  const f=fixture();
  for(const flag of ['EVOLUTION_PAIRING_ENABLED','EVOLUTION_INBOUND_ENABLED','EVOLUTION_ATTENDANCE_ENABLED','ATENDEVENDE_PILOT_LIVE_ENABLED','ATENDEVENDE_PILOT_GO_LIVE_APPROVED']){
   const result=await createEvolutionAttendanceRuntime({...env,[flag]:'false'}).runOnce();
   expect(result.processed).toBe(0);
  }
  expect(f.pending).not.toHaveBeenCalled();expect(f.recover).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
 });
 it('uses approved scope, exact outbox hash and outbound fence before sending',async()=>{
  const f=fixture(),result=await createEvolutionAttendanceRuntime(env).runOnce();
  expect(result.sent).toBe(1);expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0][1]).toBe('5511999999999');
  expect(f.finish).toHaveBeenCalledWith(expect.objectContaining(s),'SENT',expect.any(Number),'fixture-out');
 });
 it('suppresses inactive entitlement and disallowed tenant without calling provider send',async()=>{
  const f=fixture();
  f.plan.mockRejectedValue(Object.assign(new Error('inactive fixture'),{code:'SUBSCRIPTION_INACTIVE'}));
  const result=await createEvolutionAttendanceRuntime(env).runOnce();
  expect(result.failed).toBe(0);expect(f.finish).toHaveBeenCalledWith(expect.objectContaining(s),'SUPPRESSED',expect.any(Number));
  f.finish.mockClear();
  await createEvolutionAttendanceRuntime({...env,ATENDEVENDE_PILOT_ALLOWED_UNITS:'{}'}).runOnce();
  expect(f.finish).toHaveBeenCalledWith(expect.objectContaining(s),'SUPPRESSED',expect.any(Number));expect(f.send).not.toHaveBeenCalled();
 });
 it('suppresses an explicitly paused or malformed reconciliation binding even with all global flags enabled',async()=>{
  const f=fixture();
  for(const value of [true,'invalid']){
   fake.docs.set(key,{...fake.docs.get(key),reconciliationRequired:value});
   const result=await createEvolutionAttendanceRuntime(env).runOnce();
   expect(result.sent).toBe(0);expect(f.finish).toHaveBeenCalledWith(expect.objectContaining(s),'SUPPRESSED',expect.any(Number));
  }
  expect(f.send).not.toHaveBeenCalled();
 });
 it('fails closed on expired outbound fencing and never retries an uncertain send',async()=>{
  const f=fixture(true),result=await createEvolutionAttendanceRuntime(env).runOnce();
  expect(result.uncertain).toBe(1);expect(f.send).not.toHaveBeenCalled();
  expect(f.finish).toHaveBeenCalledWith(expect.objectContaining(s),'UNKNOWN',expect.any(Number));
 });
});
