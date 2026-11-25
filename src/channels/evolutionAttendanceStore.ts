import {getFirestore,type Firestore,type Transaction} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {channelDocId,channelError} from './whatsappConnections';
import {attendanceHash,attendanceIds,assertAttendanceJob,contactCommand,recentAttendance,
 type AttendanceEvent,type AttendanceScope,type AttendanceJob,type AttendanceStore,
 type AttendanceReply,type AttendanceAuthorization} from './evolutionAttendance';
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
 return sameScope(b,j)&&b!.instanceName===j.instanceName&&b!.status==='CONNECTED';
}
/** Called only from the authenticated Evolution webhook transaction.
 * No Meta trust proof, memory consent, booking or payment authorization is created. */
export async function stageEvolutionAttendance(db:Firestore,tx:Transaction,s:AttendanceScope,e:AttendanceEvent,now:number):Promise<void>{
 const ids=attendanceIds(s,e),timestamp=new Date(now).toISOString();
 const job:AttendanceJob={...s,...e,...ids,receivedAt:timestamp,state:'RECEIVED'};
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
  tx.create(r.conversation,next);
 }else{
  tx.update(r.conversation,{lastMessageAt:conversation.lastMessageAt>e.occurredAt?conversation.lastMessageAt:e.occurredAt,
   updatedAt:timestamp,...(cmd==='OPT_OUT'?{handlingMode:'HUMAN'}:{})});
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
export class FirestoreEvolutionAttendanceStore implements AttendanceStore{
 constructor(private readonly db:Firestore=database()){}
 async pending(limit:number){
  const rows=await this.db.collection('evolutionInboundInbox').where('state','==','RECEIVED').limit(limit).get();
  return rows.docs.map(d=>d.data() as AttendanceJob);
 }
 async claim(input:AttendanceJob,claimId:string,now:number){
  const r=refs(this.db,input);
  return this.db.runTransaction(async tx=>{
   const j=currentJob(await tx.get(r.inbox),input);
   if(j.state!=='RECEIVED')return null;
   const [c,p,customer]=await Promise.all([tx.get(r.conversation),tx.get(r.preference),tx.get(r.customer)]);
   if(c.get('tenantId')!==j.tenantId||c.get('customerId')!==j.customerId||
    customer.get('tenantId')!==j.tenantId||customer.get('phone')!==j.sender)throw bad();
   if(p.exists&&(!sameScope(p.data(),j)||p.get('recipient')!==j.sender))throw bad();
   if(c.get('handlingMode')!=='AI'||c.get('status')!=='OPEN'||customer.get('status')!=='ACTIVE'||
    p.get('preference')==='OPT_OUT'||!recentAttendance(j,now)||contactCommand(j.text)||
    c.get('lastMessageAt')>j.occurredAt){
    tx.update(r.inbox,{state:'SUPPRESSED',finishedAt:new Date(now).toISOString()});return null;
   }
   const next:AttendanceJob={...j,state:'PROCESSING',claimId,leaseUntil:now+120000};
   tx.update(r.inbox,{state:next.state,claimId,leaseUntil:next.leaseUntil});return next;
  });
 }
 async reserve(input:AttendanceJob,reply:AttendanceReply,authorization:AttendanceAuthorization,now:number){
  const r=refs(this.db,input),timestamp=new Date(now).toISOString();
  return this.db.runTransaction(async tx=>{
   const j=currentJob(await tx.get(r.inbox),input);
   if(j.state!=='PROCESSING'||j.claimId!==input.claimId||(j.leaseUntil??0)<=now)return false;
   const [b,m,c,p,customer,o,profile,cap,sub]=await Promise.all([
    tx.get(r.binding),tx.get(r.meta),tx.get(r.conversation),tx.get(r.preference),
    tx.get(r.customer),tx.get(r.outbox),tx.get(r.profile),tx.get(r.capabilities),tx.get(r.subscription)]);
   if(o.exists)throw bad();
   if(!bound(b.data(),j)||b.get('leaseUntil')>now||m.get('status')==='ACTIVE'||
    c.get('tenantId')!==j.tenantId||c.get('customerId')!==j.customerId||c.get('handlingMode')!=='AI'||
    c.get('status')!=='OPEN'||c.get('lastMessageAt')>j.occurredAt||customer.get('tenantId')!==j.tenantId||
    customer.get('phone')!==j.sender||customer.get('status')!=='ACTIVE'||
    p.exists&&(!sameScope(p.data(),j)||p.get('recipient')!==j.sender||p.get('preference')==='OPT_OUT')||
    !recentAttendance(j,now)||!sameScope(profile.data(),j)||!sameScope(cap.data(),j)||
    profile.get('latestVersion')!==authorization.profile.version||cap.get('latestVersion')!==authorization.capabilityVersion||
    reply.profileVersion!==authorization.profile.version)return false;
   const plan=sub.data() as Subscription|undefined;
   if(!plan||plan.tenantId!==j.tenantId||plan.status!=='ACTIVE'||
    !(Date.parse(plan.periodStart)<=now&&Date.parse(plan.periodEnd)>now)||
    !['BASIC','STANDARD','PRO','PREMIUM'].includes(plan.planCode)||
    !getPlanDefinition(plan.planCode).features.includes('AI_CHAT'))return false;
   // Serialize outbound with disconnect/re-pair and competing sends.
   tx.update(r.binding,{leaseId:j.claimId,leaseUntil:now+60000,updatedAt:timestamp});
   tx.create(r.outbox,{tenantId:j.tenantId,unitId:j.unitId,jobId:j.id,claimId:j.claimId,
    conversationId:j.conversationId,customerId:j.customerId,recipient:j.sender,
    payloadHash:attendanceHash(j.id,j.sender,reply.text),text:reply.text,source:reply.source,
    profileVersion:reply.profileVersion,status:'RESERVED',createdAt:timestamp});
   tx.update(r.inbox,{state:'RESERVED',leaseUntil:now+60000});return true;
  });
 }
 async finish(input:AttendanceJob,state:'SENT'|'UNKNOWN'|'HANDOFF'|'SUPPRESSED',now:number,externalId?:string){
  const r=refs(this.db,input),timestamp=new Date(now).toISOString();
  await this.db.runTransaction(async tx=>{
   const j=currentJob(await tx.get(r.inbox),input);
   if(j.claimId!==input.claimId||!['PROCESSING','RESERVED'].includes(j.state))throw bad();
   const [out,b,c]=await Promise.all([tx.get(r.outbox),tx.get(r.binding),tx.get(r.conversation)]);
   if(j.state==='RESERVED'){
    if(!sameScope(out.data(),j)||out.get('status')!=='RESERVED'||out.get('claimId')!==j.claimId||
     !['SENT','UNKNOWN'].includes(state))throw bad();
    if(state==='SENT'){
     if(typeof externalId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(externalId))throw bad();
     const id='evo_'+attendanceHash(j.tenantId,j.unitId,'out',externalId);
     const msg:Message={id,tenantId:j.tenantId,customerId:j.customerId,conversationId:j.conversationId,
      direction:'OUTBOUND',senderType:'AI',type:'TEXT',text:out.get('text'),
      externalMessageId:evolutionExternalId(j,externalId),occurredAt:timestamp,idempotencyKey:j.id};
     tx.create(this.db.collection('messages').doc(id),msg);
    }
    tx.update(r.outbox,{status:state,updatedAt:timestamp,...(externalId?{externalMessageId:externalId}:{})});
    if(bound(b.data(),j)&&b.get('leaseId')===j.claimId)tx.update(r.binding,{leaseId:'',leaseUntil:0,updatedAt:timestamp});
   }else if(state==='SENT'||state==='UNKNOWN'||out.exists)throw bad();
   if(c.get('tenantId')===j.tenantId&&c.get('customerId')===j.customerId){
    if((state==='HANDOFF'||state==='UNKNOWN')&&c.get('handlingMode')==='AI')tx.update(r.conversation,{handlingMode:'HANDOFF',updatedAt:timestamp});
    else if(state==='SENT')tx.update(r.conversation,{lastMessageAt:c.get('lastMessageAt')>timestamp?c.get('lastMessageAt'):timestamp,updatedAt:timestamp});
   }
   tx.update(r.inbox,{state,finishedAt:timestamp,leaseUntil:0});
  });
 }
 async recover(now:number,limit:number){
  let count=0;
  for(const state of ['PROCESSING','RESERVED'] as const){
   const rows=await this.db.collection('evolutionInboundInbox').where('state','==',state).limit(limit).get();
   for(const row of rows.docs){
    const j=row.data() as AttendanceJob;
    if((j.leaseUntil??Infinity)<=now){assertAttendanceJob(j);
     try{await this.finish(j,state==='RESERVED'?'UNKNOWN':'HANDOFF',now);count++;}catch{/* raced settlement */}}
   }
  }
  return count;
 }
}
function evolutionExternalId(j:AttendanceJob,id:string){return attendanceHash(j.tenantId,j.unitId,'out',id);}
