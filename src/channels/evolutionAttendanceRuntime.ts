import {randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';
import {FirestoreCapabilityRepository} from '../capabilities/firestoreRepository';
import {CapabilityRegistryService} from '../capabilities/service';
import {FirestoreSubscriptionRepository} from '../plans/firestoreRepository';
import {FeatureEntitlementService} from '../plans/service';
import {pilotLiveFeatureEnabled,requirePilotLiveFeature} from '../operations/pilotFlags';
import {createRuntimeAIRouter} from '../ai/runtime';
import {channelDocId,channelError,FirestoreWhatsAppConnectionStore} from './whatsappConnections';
import {EvolutionV2Client,GoogleEvolutionVault} from './evolutionClient';
import {FirestoreEvolutionAttendanceStore} from './evolutionAttendanceStore';
import {EvolutionAttendanceWorker,attendanceHash,assertAttendanceJob,recentAttendance,type AttendanceJob} from './evolutionAttendance';

/** Worker only. No HTTP endpoint can initiate a send or bypass the commercial gate. */
export function createEvolutionAttendanceRuntime(env:NodeJS.ProcessEnv=process.env){
 const profiles=new FirestoreBusinessProfileRepository();
 const caps=new CapabilityRegistryService(new FirestoreCapabilityRepository(),profiles);
 const plans=new FeatureEntitlementService(new FirestoreSubscriptionRepository());
 const meta=new FirestoreWhatsAppConnectionStore();
 const db=getFirestore(ensureFirebaseAdminApp());
 const vault=new GoogleEvolutionVault();
 const client=new EvolutionV2Client(env.EVOLUTION_API_ORIGIN??'');
 const enabled=()=>env.EVOLUTION_PAIRING_ENABLED==='true'&&env.EVOLUTION_INBOUND_ENABLED==='true'&&
  env.EVOLUTION_ATTENDANCE_ENABLED==='true'&&env.ATENDEVENDE_PILOT_LIVE_ENABLED==='true'&&
  env.ATENDEVENDE_PILOT_GO_LIVE_APPROVED==='true';
 const binding=async(j:AttendanceJob,lease?:string)=>{
  assertAttendanceJob(j);
  const ref=db.collection('merchantEvolutionConnections').doc(channelDocId(j.tenantId,j.unitId));
  const b=await ref.get();
  if(b.get('tenantId')!==j.tenantId||b.get('unitId')!==j.unitId||b.get('instanceName')!==j.instanceName||
   b.get('status')!=='CONNECTED'||typeof b.get('ownerPhone')!=='string'||b.get('ownerPhone')===j.sender||
   (lease&&(b.get('leaseUntil')>Date.now()||b.get('outboundLeaseId')!==lease||b.get('outboundLeaseUntil')<=Date.now())))return null;
  const c=await vault.load(j.tenantId,j.unitId);
  if(!c||c.expectedOwnerPhone!==b.get('ownerPhone'))return null;
  const claim=await db.collection('evolutionPhoneReservations').doc(attendanceHash(c.expectedOwnerPhone)).get();
  if(claim.get('tenantId')!==j.tenantId||claim.get('unitId')!==j.unitId||
   claim.get('instanceName')!==j.instanceName||claim.get('ownerPhone')!==c.expectedOwnerPhone)return null;
  if((await meta.get(j.tenantId,j.unitId))?.status==='ACTIVE'||await client.state(c)!=='open'||
   await client.ownerPhone(c)!==c.expectedOwnerPhone)return null;
  if(env.PUBLIC_APP_URL!=='https://app.atendevendeia.com.br')return null;
  await client.verifyWebhook(c,env.PUBLIC_APP_URL+'/api/channels/webhooks/evolution/'+j.tenantId+'/'+j.unitId);
  return c;
 };
 return new EvolutionAttendanceWorker(new FirestoreEvolutionAttendanceStore(db),{
  enabled,
  ai:createRuntimeAIRouter(env),
  async authorize(j){
   if(!enabled()||!pilotLiveFeatureEnabled('WHATSAPP_OUTBOUND',j.tenantId,j.unitId,env)||
    !recentAttendance(j,Date.now()))return null;
   const ctx={tenantId:j.tenantId,userId:'service:evolution-attendance',role:'OPERATOR',requestId:j.id};
   const [profile,cap,customers,knowledge,canUse]=await Promise.all([
    profiles.effective(j.tenantId,j.unitId,new Date().toISOString()),
    caps.resolve(ctx,j.unitId,'CORE_AI_ASSIST'),caps.resolve(ctx,j.unitId,'CORE_CUSTOMERS'),
    caps.resolve(ctx,j.unitId,'CORE_KNOWLEDGE'),plans.canUse(j.tenantId,'AI_CHAT').catch((e:unknown)=>{
     if(['SUBSCRIPTION_INACTIVE','SUBSCRIPTION_OUT_OF_PERIOD'].includes((e as {code?:string})?.code??''))return false;throw e;
    })]);
   if(!profile||!cap.authorized||!customers.authorized||!knowledge.authorized||!cap.assignmentVersion||!canUse||
    !await binding(j))return null;
   return {profile,capabilityVersion:cap.assignmentVersion};
  },
  async send(j,text){
   if(!enabled())throw channelError('EVOLUTION_ATTENDANCE_DISABLED');
   requirePilotLiveFeature('WHATSAPP_OUTBOUND',j.tenantId,j.unitId,env);
   if(!j.claimId||!recentAttendance(j,Date.now()))throw channelError('EVOLUTION_ATTENDANCE_WINDOW_EXPIRED');
   const c=await binding(j,j.claimId);
   const out=await db.collection('evolutionAttendanceOutbox').doc(j.id).get();
   if(!c||out.get('status')!=='RESERVED'||out.get('claimId')!==j.claimId||
    out.get('tenantId')!==j.tenantId||out.get('unitId')!==j.unitId||out.get('recipient')!==j.sender||
    out.get('payloadHash')!==attendanceHash(j.id,j.sender,text))throw channelError('EVOLUTION_ATTENDANCE_RESERVATION_INVALID');
   const fence=await db.collection('merchantEvolutionConnections').doc(channelDocId(j.tenantId,j.unitId)).get();
   if(fence.get('outboundLeaseId')!==j.claimId||fence.get('outboundLeaseUntil')<=Date.now()||
    fence.get('status')!=='CONNECTED'||fence.get('leaseUntil')>Date.now())throw channelError('EVOLUTION_ATTENDANCE_RESERVATION_INVALID');
   return client.sendText(c,j.sender,text);
  },
 },randomUUID);
}
