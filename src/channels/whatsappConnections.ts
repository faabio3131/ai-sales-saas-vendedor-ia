import {createHash} from 'node:crypto';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {ApplicationError} from '../infrastructure/errors';
import type {TenantContext} from '../types/contracts';

export type WhatsAppStatus='PENDING_VERIFICATION'|'ACTIVE'|'DISABLED';
export interface WhatsAppConnection{
 tenantId:string;unitId:string;phoneNumberId:string;wabaId:string;
 status:WhatsAppStatus;credentialRef?:string;version:number;
 createdAt:string;updatedAt:string;verificationEvidenceRef?:string;verifiedAt?:string;
}
export interface WhatsAppConnectionStore{
 get(tenantId:string,unitId:string):Promise<WhatsAppConnection|null>;
 write(next:WhatsAppConnection,expectedVersion:number):Promise<void>;
}
export const CHANNEL_UNIT=/^[A-Za-z0-9_-]{1,96}$/;
export const CHANNEL_TENANT=/^[A-Za-z0-9_-]{1,100}$/;
export const META_ID=/^[1-9][0-9]{5,30}$/;
export function channelError(code:string,category:'FORBIDDEN'|'CONFLICT'|'VALIDATION'|'PROVIDER'='FORBIDDEN'){
 return new ApplicationError({code,category,message:'WhatsApp channel is unavailable or its configuration is incomplete.'});
}
export function requireExclusivePhoneClaim(
 claim:{tenantId:string;unitId:string}|undefined,tenantId:string,unitId:string){
 if(claim&&(claim.tenantId!==tenantId||claim.unitId!==unitId))
  throw channelError('CHANNEL_PHONE_ALREADY_BOUND','CONFLICT');
}
export function channelDocId(tenantId:string,unitId:string){
 if(!CHANNEL_TENANT.test(tenantId)||!CHANNEL_UNIT.test(unitId))throw channelError('CHANNEL_SCOPE_INVALID');
 return createHash('sha256').update(JSON.stringify([tenantId,unitId])).digest('hex');
}
function db(){
 if(!getApps().length)initializeApp(process.env.FIREBASE_PROJECT_ID?{projectId:process.env.FIREBASE_PROJECT_ID}:undefined);
 return getFirestore();
}
export class FirestoreWhatsAppConnectionStore implements WhatsAppConnectionStore{
 async get(t:string,u:string){
  const snap=await db().collection('merchantWhatsAppConnections').doc(channelDocId(t,u)).get();
  const data=snap.data() as WhatsAppConnection|undefined;
  if(!data)return null;
  if(data.tenantId!==t||data.unitId!==u)throw channelError('CHANNEL_SCOPE_MISMATCH');
  return data;
 }
 async write(next:WhatsAppConnection,expectedVersion:number){
  const ref=db().collection('merchantWhatsAppConnections').doc(channelDocId(next.tenantId,next.unitId));
  await db().runTransaction(async tx=>{
   // A Meta phone_number_id is a globally unique routing identity, NOT just
   // a tenant preference. Reserve it atomically to prevent cross-tenant reuse.
   const phoneRef=db().collection('whatsappPhoneReservations').doc(next.phoneNumberId);
   const prev=await tx.get(ref),reservation=await tx.get(phoneRef);
   if(next.status==='ACTIVE'){
    const evo=await tx.get(db().collection('merchantEvolutionConnections').doc(channelDocId(next.tenantId,next.unitId)));
    if(evo.exists&&(evo.get('tenantId')!==next.tenantId||evo.get('unitId')!==next.unitId||
     evo.get('status')!=='DISCONNECTED'||evo.get('leaseUntil')>Date.now()||evo.get('outboundLeaseId')))
     throw channelError('CHANNEL_EVOLUTION_ACTIVE_CONFLICT','CONFLICT');
   }
   const data=prev.data() as WhatsAppConnection|undefined;
   const claim=reservation.data() as {tenantId:string;unitId:string}|undefined;
   if((data?.version??0)!==expectedVersion||Boolean(data)!==(expectedVersion>0))
    throw channelError('CHANNEL_VERSION_CONFLICT','CONFLICT');
   if(data&&(data.tenantId!==next.tenantId||data.unitId!==next.unitId))
    throw channelError('CHANNEL_SCOPE_MISMATCH');
   requireExclusivePhoneClaim(claim,next.tenantId,next.unitId);
   if(next.version!==expectedVersion+1)throw channelError('CHANNEL_VERSION_CONFLICT','CONFLICT');
   let previousPhoneRef:FirebaseFirestore.DocumentReference|undefined;
   if(data&&data.phoneNumberId!==next.phoneNumberId){
    previousPhoneRef=db().collection('whatsappPhoneReservations').doc(data.phoneNumberId);
    const oldClaim=await tx.get(previousPhoneRef);
    const owner=oldClaim.data() as {tenantId:string;unitId:string}|undefined;
    if(owner&&(owner.tenantId!==next.tenantId||owner.unitId!==next.unitId))
     throw channelError('CHANNEL_PHONE_RESERVATION_CONFLICT','CONFLICT');
   }
   if(previousPhoneRef)tx.delete(previousPhoneRef);
   tx.set(phoneRef,{tenantId:next.tenantId,unitId:next.unitId,phoneNumberId:next.phoneNumberId,
    updatedAt:next.updatedAt});
   tx.set(ref,next);
  });
 }
}
function plain(v:unknown):v is Record<string,unknown>{
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
}
export function whatsappVaultReference(tenantId:string,unitId:string,
 backend:'MOUNTED'|'GOOGLE',projectId?:string){
 const hash=channelDocId(tenantId,unitId);
 if(backend==='MOUNTED')return 'mounted:'+hash;
 if(!projectId||!/^[A-Za-z0-9_-]{4,80}$/.test(projectId))
  throw channelError('CHANNEL_SECRET_PROJECT_INVALID','VALIDATION');
 return 'projects/'+projectId+'/secrets/avwa-'+hash.slice(0,48)+'/versions/latest';
}
export interface WhatsAppExternalVerifier{
 /** Independent successful real app/WABA/phone verification; never return true for a fixture in production. */
 verify(conn:WhatsAppConnection):Promise<{verified:boolean;evidenceRef:string}>;
}
export class WhatsAppRegistrationService{
 constructor(private readonly store:WhatsAppConnectionStore,
  private readonly externalVerifier:WhatsAppExternalVerifier,private readonly clock:()=>Date=()=>new Date()){}
 async overview(ctx:TenantContext,unitId:string){
  if(!CHANNEL_TENANT.test(ctx.tenantId)||!CHANNEL_UNIT.test(unitId))
   throw channelError('CHANNEL_SCOPE_INVALID');
  const conn=await this.store.get(ctx.tenantId,unitId);
  return {unitId,channel:'WHATSAPP',status:conn?.status??'NOT_CONFIGURED',
   phoneNumberConfigured:Boolean(conn?.phoneNumberId),wabaConfigured:Boolean(conn?.wabaId),
   credentialConfigured:Boolean(conn?.credentialRef),liveActivated:conn?.status==='ACTIVE'};
 }
 async register(ctx:TenantContext,unitId:string,raw:unknown){
  if(ctx.role!=='OWNER'||!ctx.userId)throw channelError('CHANNEL_OWNER_REQUIRED');
  if(!CHANNEL_TENANT.test(ctx.tenantId)||!CHANNEL_UNIT.test(unitId))
   throw channelError('CHANNEL_SCOPE_INVALID','VALIDATION');
  if(!plain(raw)||Object.keys(raw).some(k=>!['phoneNumberId','wabaId'].includes(k))||
    typeof raw.phoneNumberId!=='string'||!META_ID.test(raw.phoneNumberId)||
    typeof raw.wabaId!=='string'||!META_ID.test(raw.wabaId))
   throw channelError('CHANNEL_REGISTRATION_INVALID','VALIDATION');
  const old=await this.store.get(ctx.tenantId,unitId);
  if(old?.status==='ACTIVE')throw channelError('CHANNEL_ACTIVE_CONNECTION_LOCKED','CONFLICT');
  if(old?.status==='PENDING_VERIFICATION'&&old.phoneNumberId===raw.phoneNumberId&&old.wabaId===raw.wabaId)
   return this.overview(ctx,unitId);
  const now=this.clock().toISOString();
  await this.store.write({tenantId:ctx.tenantId,unitId,phoneNumberId:raw.phoneNumberId,
   wabaId:raw.wabaId,status:'PENDING_VERIFICATION',version:(old?.version??0)+1,
   createdAt:old?.createdAt??now,updatedAt:now},old?.version??0);
  return this.overview(ctx,unitId);
 }
 /** Server-side operations only. The merchant HTTP API CANNOT supply a vault reference. */
 async attachVault(t:string,u:string,backend:'MOUNTED'|'GOOGLE',projectId?:string){
  const old=await this.store.get(t,u);
  if(!old||old.status!=='PENDING_VERIFICATION')
   throw channelError('CHANNEL_NOT_PENDING','CONFLICT');
  const ref=whatsappVaultReference(t,u,backend,projectId);
  await this.store.write({...old,credentialRef:ref,version:old.version+1,
   updatedAt:this.clock().toISOString()},old.version);
 }
 /** Server-side operations only; requires independently verified Meta subscription. */
 async verifyAndActivate(t:string,u:string){
  const old=await this.store.get(t,u);
  if(!old||old.status!=='PENDING_VERIFICATION'||!old.credentialRef)
   throw channelError('CHANNEL_NOT_PROVISIONED','CONFLICT');
  const proof=await this.externalVerifier.verify(old);
  if(proof.verified!==true||!/^external:[a-zA-Z0-9._:/-]{10,180}$/.test(proof.evidenceRef))
   throw channelError('CHANNEL_EXTERNAL_VERIFICATION_REQUIRED','CONFLICT');
  const now=this.clock().toISOString();
  await this.store.write({...old,status:'ACTIVE',verifiedAt:now,
   verificationEvidenceRef:proof.evidenceRef,updatedAt:now,version:old.version+1},old.version);
 }
 async disable(t:string,u:string){
  const old=await this.store.get(t,u);
  if(!old)throw channelError('CHANNEL_NOT_FOUND','CONFLICT');
  await this.store.write({...old,status:'DISABLED',version:old.version+1,
   updatedAt:this.clock().toISOString()},old.version);
 }
}
