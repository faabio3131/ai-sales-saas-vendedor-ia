import {getFirestore,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {channelDocId,channelError,evolutionReconciliationPending} from './whatsappConnections';
import {attendanceHash,attendanceIds,assertAttendanceJob,contactCommand,recentAttendance,
 type AttendanceEvent,type AttendanceScope,type AttendanceJob,type AttendanceStore,
 type AttendanceReply,type AttendanceAuthorization,type AttendanceReservation} from './evolutionAttendance';
import type {Customer} from '../customers/model';
import type {Conversation,Message} from '../conversations/model';
import type {Subscription} from '../plans/model';
import {getPlanDefinition} from '../plans/catalog';

const database=()=>getFirestore(ensureFirebaseAdminApp());
const bad=()=>channelError('EVOLUTION_ATTENDANCE_STORE_CONFLICT','CONFLICT');
function refs(db:Firestore,j:AttendanceJob){
 const scope=channelDocId(j.tenantId,j.unitId);
 return {
 inbox:db.collection('evolutionInboundInbox').doc(j.id),
 binding:db.collection('merchantEvolutionConnections').doc(scope),
 meta:db.collection('merchantWhatsAppConnections').doc(scope),
 customer:db.collection('customers').doc(j.customerId),
 conversation:db.collection('conversations').doc(j.conversationId),
 message:db.collection('messages').doc(j.messageId),
 preference:db.collection('evolutionContactPreferences').doc(attendanceHash(j.tenantId,j.unitId,j.sender)),
 outbox:db.collection('evolutionAttendanceOutbox').doc(j.id),
 profile:db.collection('businessProfiles').doc(scope),
 capabilities:db.collection('unitCapabilityAssignments').doc(scope),
 subscription:db.collection('subscriptions').doc(j.tenantId),
 };
}
function sameScope(x:FirebaseFirestore.DocumentData|undefined,j:AttendanceScope){
 return !!x&&x.tenantId===j.tenantId&&x.unitId===j.unitId;
}
function bound(b:FirebaseFirestore.DocumentData|undefined,j:AttendanceJob){
 return sameScope(b,j)&&b!.instanceName===j.instanceName&&b!.status==='CONNECTED'&&!evolutionReconciliationPending(b!.reconciliationRequired);
}
/** Called only from the authenticated Evolution webhook transaction.
 * No Meta trust proof, memory consent, booking or payment authorization is created. */
export async function stageEvolutionAttendance(db:Firestore,tx:Transaction,s:AttendanceScope,e:AttendanceEvent,now:number):Promise<void>{
 const ids=attendanceIds(s,e),timestamp=new Date(now).toISOString();
 const job:AttendanceJob={...s,...e,...ids,receivedAt:timestamp,state:'RECEIVED',nextAttemptAt:now};
 const r=refs(db,job);
 const [customerDoc,conversationDoc,messageDoc,preferenceDoc]=await Promise.all([
  tx.get(r.customer),tx.get(r.conversation),tx.get(r.message),tx.get(r.preference)]);
 const customer=customerDoc.data() as Customer|undefined;
 const conversation=conversationDoc.data() as Conversation|undefined;
 const preference=preferenceDoc.data();
 const identity=job.unitId+':'+job.sender;
 if(customer&&(customer.id!==job.customerId||customer.tenantId!==job.tenantId||customer.phone!==job.sender||
  !customer.externalIdentities.some(x=>x.source==='evolution'&&x.value===identity)))throw bad();
 if(conversation&&(conversation.id!==job.conversationId||conversation.tenantId!==job.tenantId||
  conversation.customerId!==job.customerId||conversation.channel!=='WHATSAPP'||
  conversation.externalConversationId!==job.conversationId))throw bad();
 if(messageDoc.exists||preference&&!sameScope(preference,job)||preference&&preference.recipient!==job.sender)throw bad();
 const cmd=contactCommand(e.text);
 if(cmd&&(!preference||preference.recordedAt<e.occurredAt||
  preference.recordedAt===e.occurredAt&&cmd==='OPT_OUT')){
  tx.set(r.preference,{...s,recipient:e.sender,preference:cmd,recordedAt:e.occurredAt,
   source:'AUTHENTICATED_EVOLUTION_INBOUND',eventId:job.id});
 }
 if(!customer){
  const next:Customer={id:job.customerId,tenantId:s.tenantId,name:'Contato WhatsApp',
   phone:e.sender,externalIdentities:[{source:'evolution',value:identity}],status:'ACTIVE',createdAt:timestamp,updatedAt:timestamp};
  tx.create(r.customer,{...next,externalIdentityKeys:['evolution:'+identity]});
 }
 if(!conversation){
  const next:Conversation={id:job.conversationId,tenantId:s.tenantId,customerId:job.customerId,
   channel:'WHATSAPP',externalConversationId:job.conversationId,status:'OPEN',
   handlingMode:cmd==='OPT_OUT'?'HUMAN':'AI',lastMessageAt:e.occurredAt,createdAt:timestamp,updatedAt:timestamp};
  tx.create(r.conversation,{...next,lastInboundAt:e.occurredAt,lastInboundMessageId:job.messageId});
 }else{
  tx.update(r.conversation,{lastMessageAt:conversation.lastMessageAt>e.occurredAt?conversation.lastMessageAt:e.occurredAt,
   updatedAt:timestamp,...(e.occurredAt>=(conversationDoc.get('lastInboundAt')??'')?{lastInboundAt:e.occurredAt,lastInboundMessageId:job.messageId}:{}),
   ...(cmd==='OPT_OUT'?{handlingMode:'HUMAN'}:{})});
 }
 const message:Message={id:job.messageId,tenantId:s.tenantId,customerId:job.customerId,
  conversationId:job.conversationId,direction:'INBOUND',senderType:'CUSTOMER',type:'TEXT',
  text:e.text,externalMessageId:job.id,occurredAt:e.occurredAt,idempotencyKey:job.id};
 tx.create(r.message,message);
 tx.create(r.inbox,{...job,provider:'EVOLUTION'});
}
function currentJob(row:FirebaseFirestore.DocumentSnapshot,expected:AttendanceJob):AttendanceJob{
 const j=row.data() as AttendanceJob|undefined;
 if(!j||j.id!==expected.id||j.tenantId!==expected.tenantId||j.unitId!==expected.unitId||
  j.text!==expected.text||j.sender!==expected.sender||j.externalMessageId!==expected.externalMessageId)throw bad();
 assertAttendanceJob(j);return j;
}
function reservedOutboxMatches(out:FirebaseFirestore.DocumentSnapshot,j:AttendanceJob){
 return sameScope(out.data(),j)&&out.get('status')==='RESERVED'&&typeof j.claimId==='string'&&j.claimId.length>0&&out.get('claimId')===j.claimId;
}
function superseded(c:FirebaseFirestore.DocumentSnapshot,j:AttendanceJob){
 const at=c.get('lastInboundAt'),id=c.get('lastInboundMessageId');
 // Compare only inbound ordering; an outbound timestamp cannot suppress a new message.
 return typeof at==='string'&&(at>j.occurredAt||at===j.occurredAt&&id!==j.messageId);
}
export class FirestoreEvolutionAttendanceStore implements AttendanceStore{
 constructor(private readonly db:Firestore=database()){}
 async pending(limit:number,now:number){
  const rows=await this.db.collection('evolutionInboundInbox').where('state','==','RECEIVED')
   .where('nextAttemptAt','<=',now).orderBy('nextAttemptAt','asc').limit(limit).get();
  const jobs:AttendanceJob[]=[];
  for(const row of rows.docs){
   try{const j=row.data() as AttendanceJob;assertAttendanceJob(j);if(row.id!==j.id)throw bad();jobs.push(j);}
   catch{await this.quarantineInvalid(row.ref,'RECEIVED',now).catch(()=>{});}
  }
  return jobs;
 }
 async claim(input:AttendanceJob,claimId:string,now:number){
  const r=refs(this.db,input);
  return this.db.runTransaction(async tx=>{
   const j=currentJob(await tx.get(r.inbox),input);
   if(j.state!=='RECEIVED'||(j.nextAttemptAt??0)>now)return null;
   const [c,p,customer]=await Promise.all([tx.get(r.conversation),tx.get(r.preference),tx.get(r.customer)]);
   if(c.get('tenantId')!==j.tenantId||c.get('customerId')!==j.customerId||
    customer.get('tenantId')!==j.tenantId||customer.get('phone')!==j.sender)throw bad();
   if(p.exists&&(!sameScope(p.data(),j)||p.get('recipient')!==j.sender))throw bad();
   if(c.get('handlingMode')!=='AI'||c.get('status')!=='OPEN'||customer.get('status')!=='ACTIVE'||
    p.get('preference')==='OPT_OUT'||!recentAttendance(j,now)||contactCommand(j.text)||
    superseded(c,j)){
    tx.update(r.inbox,{state:'SUPPRESSED',finishedAt:new Date(now).toISOString()});return null;
   }
   const next:AttendanceJob={...j,state:'PROCESSING',claimId,leaseUntil:now+120000};
   tx.update(r.inbox,{state:next.state,claimId,leaseUntil:next.leaseUntil});return next;
  });
 }
 async reserve(input:AttendanceJob,reply:AttendanceReply,authorization:AttendanceAuthorization,now:number):Promise<AttendanceReservation>{
  const r=refs(this.db,input),timestamp=new Date(now).toISOString();
  return this.db.runTransaction(async tx=>{
   const j=currentJob(await tx.get(r.inbox),input);
   if(j.state!=='PROCESSING'||j.claimId!==input.claimId||(j.leaseUntil??0)<=now)return 'STALE';
   const [b,m,c,p,customer,o,profile,cap,sub]=await Promise.all([
    tx.get(r.binding),tx.get(r.meta),tx.get(r.conversation),tx.get(r.preference),
    tx.get(r.customer),tx.get(r.outbox),tx.get(r.profile),tx.get(r.capabilities),tx.get(r.subscription)]);
   if(o.exists)throw bad();
   if(!bound(b.data(),j)||m.get('status')==='ACTIVE'||
    c.get('tenantId')!==j.tenantId||c.get('customerId')!==j.customerId||c.get('handlingMode')!=='AI'||
    c.get('status')!=='OPEN'||superseded(c,j)||customer.get('tenantId')!==j.tenantId||
    customer.get('phone')!==j.sender||customer.get('status')!=='ACTIVE'||
    p.exists&&(!sameScope(p.data(),j)||p.get('recipient')!==j.sender||p.get('preference')==='OPT_OUT')||
    !recentAttendance(j,now)||!sameScope(profile.data(),j)||!sameScope(cap.data(),j)||
    profile.get('latestVersion')!==authorization.profile.version||cap.get('latestVersion')!==authorization.capabilityVersion||
    reply.profileVersion!==authorization.profile.version)return 'SUPPRESSED';
   const plan=sub.data() as Subscription|undefined;
   if(!plan||plan.tenantId!==j.tenantId||plan.status!=='ACTIVE'||
    !(Date.parse(plan.periodStart)<=now&&Date.parse(plan.periodEnd)>now)||
    !['BASIC','STANDARD','PRO','PREMIUM'].includes(plan.planCode)||
    !getPlanDefinition(plan.planCode).features.includes('AI_CHAT'))return 'SUPPRESSED';
   if(b.get('leaseUntil')>now||b.get('outboundLeaseId'))return 'DEFERRED';
   // Separate outbound fencing from lifecycle: inbound can proceed during a send.
   // Do not acquire another send until even an expired reservation is settled.
   tx.update(r.binding,{outboundLeaseId:j.claimId,outboundLeaseUntil:now+60000,updatedAt:timestamp});
   tx.create(r.outbox,{tenantId:j.tenantId,unitId:j.unitId,jobId:j.id,claimId:j.claimId,
    conversationId:j.conversationId,customerId:j.customerId,recipient:j.sender,
    payloadHash:attendanceHash(j.id,j.sender,reply.text),text:reply.text,source:reply.source,
    profileVersion:reply.profileVersion,status:'RESERVED',createdAt:timestamp});
   tx.update(r.inbox,{state:'RESERVED',leaseUntil:now+60000});return 'RESERVED';
  });
 }
 async defer(input:AttendanceJob,now:number){
  const r=refs(this.db,input);
  await this.db.runTransaction(async tx=>{
   const j=currentJob(await tx.get(r.inbox),input);
   if(j.state!=='PROCESSING'||j.claimId!==input.claimId)return;
   const out=await tx.get(r.outbox);if(out.exists)throw bad();
   tx.update(r.inbox,{state:'RECEIVED',claimId:'',leaseUntil:0,nextAttemptAt:now+3000});
  });
 }
 async finish(input:AttendanceJob,state:'SENT'|'UNKNOWN'|'HANDOFF'|'SUPPRESSED',now:number,externalId?:string){
  const r=refs(this.db,input),timestamp=new Date(now).toISOString();
  await this.db.runTransaction(async tx=>{
   const j=currentJob(await tx.get(r.inbox),input);
   if(j.claimId!==input.claimId||!['PROCESSING','RESERVED'].includes(j.state))throw bad();
   const [out,b,c]=await Promise.all([tx.get(r.outbox),tx.get(r.binding),tx.get(r.conversation)]);
   if(j.state==='RESERVED'){
    if(!reservedOutboxMatches(out,j)||!['SENT','UNKNOWN'].includes(state))throw bad();
    if(state==='SENT'){
     if(typeof externalId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(externalId))throw bad();
     const id='evo_'+attendanceHash(j.tenantId,j.unitId,'out',externalId);
     const msg:Message={id,tenantId:j.tenantId,customerId:j.customerId,conversationId:j.conversationId,
      direction:'OUTBOUND',senderType:'AI',type:'TEXT',text:out.get('text'),
      externalMessageId:evolutionExternalId(j,externalId),occurredAt:timestamp,idempotencyKey:j.id};
     tx.create(this.db.collection('messages').doc(id),msg);
    }
    tx.update(r.outbox,{status:state,updatedAt:timestamp,...(externalId?{externalMessageId:externalId}:{})});
    if(sameScope(b.data(),j)&&b.get('instanceName')===j.instanceName&&b.get('outboundLeaseId')===j.claimId)
     tx.update(r.binding,{outboundLeaseId:'',outboundLeaseUntil:0,updatedAt:timestamp});
   }else if(state==='SENT'||state==='UNKNOWN'||out.exists)throw bad();
   if(c.get('tenantId')===j.tenantId&&c.get('customerId')===j.customerId){
    if((state==='HANDOFF'||state==='UNKNOWN')&&c.get('handlingMode')==='AI')tx.update(r.conversation,{handlingMode:'HANDOFF',updatedAt:timestamp});
    else if(state==='SENT')tx.update(r.conversation,{lastMessageAt:c.get('lastMessageAt')>timestamp?c.get('lastMessageAt'):timestamp,updatedAt:timestamp});
   }
   tx.update(r.inbox,{state,finishedAt:timestamp,leaseUntil:0});
  });
 }
 private async quarantineInvalid(ref:FirebaseFirestore.DocumentReference,state:string,now:number){
  await this.db.runTransaction(async tx=>{
   const row=await tx.get(ref),j=row.data() as AttendanceJob|undefined;
   if(!j||j.state!==state)return;
   if(state!=='RECEIVED'&&(typeof j.leaseUntil!=='number'||j.leaseUntil>now))return;
   let invalid=false;
   try{assertAttendanceJob(j);if(row.id!==j.id)invalid=true;}catch{invalid=true;}
   // No tenant-derived writes from a malformed job; only quarantine its own row.
   if(invalid)tx.update(ref,{state:'QUARANTINED',quarantinedAt:new Date(now).toISOString(),quarantineReason:'INVALID_JOB_IDENTITY'});
  });
 }
 private async quarantineRecoveryConflict(input:AttendanceJob,state:'PROCESSING'|'RESERVED',now:number){
  const r=refs(this.db,input);
  return this.db.runTransaction(async tx=>{
   const row=await tx.get(r.inbox);
   if(!row.exists||row.get('state')!==state||row.get('claimId')!==input.claimId||
    typeof row.get('leaseUntil')!=='number'||row.get('leaseUntil')>now)return 'changed' as const;
   const j=currentJob(row,input),out=await tx.get(r.outbox);
   const inconsistent=state==='PROCESSING'?out.exists:!reservedOutboxMatches(out,j);
   if(!inconsistent)return 'retained' as const; // transient error: keep for later retry
   // Quarantine only the inbox row after proving the conflict transactionally.
   // Keep outbox, binding fence and reservations intact for operator investigation.
   tx.update(r.inbox,{state:'QUARANTINED',quarantinedAt:new Date(now).toISOString(),
    quarantineReason:'RECOVERY_OUTBOX_CONFLICT'});
   return 'quarantined' as const;
  });
 }
 async recover(now:number,limit:number){
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw bad();
  let count=0;
  for(const state of ['PROCESSING','RESERVED'] as const){
   let cursor:FirebaseFirestore.QueryDocumentSnapshot|undefined;
   let settled=0,retained=0,quarantined=0,scanned=0;
   // Bounded cursor scan lets later rows progress even if a page cannot settle.
   // Deterministic conflicts leave the queue permanently; transient errors stay.
   for(let page=0;page<4&&settled<limit;page++){
    const query=this.db.collection('evolutionInboundInbox').where('state','==',state)
     .where('leaseUntil','<=',now).orderBy('leaseUntil','asc').limit(limit);
    const rows=await (cursor?query.startAfter(cursor):query).get();
    for(const row of rows.docs){
     if(settled>=limit)break;
     scanned++;
     const j=row.data() as AttendanceJob;
     try{assertAttendanceJob(j);if(row.id!==j.id)throw bad();}
     catch{try{await this.quarantineInvalid(row.ref,state,now);quarantined++;}catch{retained++;}continue;}
     try{
      if(state==='PROCESSING')await this.defer(j,now);
      else await this.finish(j,'UNKNOWN',now);
      settled++;count++;
     }catch{
      const disposition=await this.quarantineRecoveryConflict(j,state,now).catch(()=> 'retained' as const);
      if(disposition==='quarantined')quarantined++;
      if(disposition==='retained')retained++;
     }
    }
    if(rows.size<limit)break;
    cursor=rows.docs.at(-1);
   }
   if(retained||quarantined||scanned===4*limit)
    console.warn(JSON.stringify({event:'evolution_recovery_attention',state,retained,quarantined,scanned,settled}));
  }
  return count;
 }
}
function evolutionExternalId(j:AttendanceJob,id:string){return attendanceHash(j.tenantId,j.unitId,'out',id);}

/** Operator-only recovery. Reuse the canonical transactional store, never build
 * the attendance runtime, read an AI secret or call the provider. The scheduler
 * must already be stopped; only expired claims are eligible for settlement. */
export async function recoverEvolutionOnly(expectedProject:string,env:NodeJS.ProcessEnv=process.env,now=Date.now()){
 const project=env.FIREBASE_PROJECT_ID;
 const off=['EVOLUTION_PAIRING_ENABLED','EVOLUTION_INBOUND_ENABLED','EVOLUTION_ATTENDANCE_ENABLED',
  'ATENDEVENDE_PILOT_LIVE_ENABLED','ATENDEVENDE_PILOT_GO_LIVE_APPROVED'];
 if(!project||! /^[a-z][a-z0-9-]{4,62}$/.test(project)||project!==expectedProject||
  off.some(flag=>env[flag]!=='false')||
  (env.NODE_ENV==='test'?(env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||project!=='demo-atendevende-t10'):
   (env.NODE_ENV!=='production'||!!env.FIRESTORE_EMULATOR_HOST)))
  throw channelError('EVOLUTION_RECOVERY_SCOPE_OR_FLAGS_INVALID','VALIDATION');
 const app=ensureFirebaseAdminApp(env);
 if(app.options.projectId!==project)throw channelError('EVOLUTION_RECOVERY_PROJECT_MISMATCH','VALIDATION');
 return new FirestoreEvolutionAttendanceStore(getFirestore(app)).recover(now,10);
}
