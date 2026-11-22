import {createHash} from 'node:crypto';
import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {ApplicationError} from '../infrastructure/errors';
import type {TenantContext} from '../types/contracts';
import type {MerchantProviderConnection} from './connections';
import type {MerchantCredentialsVault} from './merchantVault';
import {mountedSecretReference} from './mountedVault';
import {providerDescriptor,type PaymentProviderId} from './providerCatalog';
import {merchantConnectionBindingHash} from './resolver';

export interface ManagedMerchantConnection extends MerchantProviderConnection{
 version:number;updatedAt:string;verificationEvidenceRef?:string;verifiedAt?:string;
}
export interface MerchantLifecycleStore{
 get(tenantId:string,providerId:PaymentProviderId):Promise<ManagedMerchantConnection|null>;
 write(next:ManagedMerchantConnection,expectedVersion:number):Promise<void>;
}
function db(){
 if(!getApps().length)initializeApp(process.env.FIREBASE_PROJECT_ID?{projectId:process.env.FIREBASE_PROJECT_ID}:undefined);
 return getFirestore();
}
export class FirestoreMerchantLifecycleStore implements MerchantLifecycleStore{
 async get(t:string,p:PaymentProviderId){
  const d=await db().collection('merchantPaymentConnections').doc(t+'__'+p).get();
  const value=d.data() as ManagedMerchantConnection|undefined;
  if(!value)return null;
  if(value.tenantId!==t||value.providerId!==p)throw error('PAYMENT_SCOPE_MISMATCH','FORBIDDEN');
  return {...value,version:value.version??0};
 }
 async write(next:ManagedMerchantConnection,expectedVersion:number){
  const ref=db().collection('merchantPaymentConnections').doc(next.tenantId+'__'+next.providerId);
  await db().runTransaction(async tx=>{
   const previous=await tx.get(ref);
   const prior=previous.data() as ManagedMerchantConnection|undefined;
   if((prior?.version??0)!==expectedVersion||Boolean(prior)!==(expectedVersion>0))
    throw error('PAYMENT_CONNECTION_VERSION_CONFLICT','CONFLICT');
   if(prior&&(prior.tenantId!==next.tenantId||prior.providerId!==next.providerId))
    throw error('PAYMENT_SCOPE_MISMATCH','FORBIDDEN');
   if(next.version!==expectedVersion+1)throw error('PAYMENT_CONNECTION_VERSION_CONFLICT','CONFLICT');
   // Record verified merchant account generations in the same transaction.
   // Never archive actual secrets; only an independently controlled vault ref.
   const generations=db().collection('merchantPaymentConnectionGenerations');
   for(const candidate of [prior,next]){
    if(candidate?.status!=='ACTIVE'||!candidate.credentialRef||!candidate.recipientId)continue;
    const hash=merchantConnectionBindingHash(candidate);
    const evidence=generations.doc(hash);
    const existing=await tx.get(evidence);
    if(existing.exists){
     const found=existing.data() as MerchantProviderConnection;
     if(found.tenantId!==candidate.tenantId||found.providerId!==candidate.providerId||
       found.recipientId!==candidate.recipientId||found.credentialRef!==candidate.credentialRef||
       found.version!==candidate.version)
      throw error('PAYMENT_HISTORY_INTEGRITY_CONFLICT','CONFLICT');
    }else tx.create(evidence,candidate);
   }
   tx.set(ref,next);
  });
 }
}
function error(code:string,category:'VALIDATION'|'FORBIDDEN'|'CONFLICT'='VALIDATION'){
 return new ApplicationError({code,category,message:'Provider onboarding rejected or external verification incomplete.'});
}
function isPlain(v:unknown):v is Record<string,unknown>{
 return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
}
const TENANT=/^[a-zA-Z0-9_-]{1,100}$/;
const RECIPIENT=/^[a-zA-Z0-9._:@-]{3,140}$/;
function id(value:unknown,pattern:RegExp):string{
 if(typeof value!=='string'||!pattern.test(value))throw error('PAYMENT_CONNECTION_IDENTITY_INVALID');
 return value;
}
function provider(value:unknown):PaymentProviderId{
 if(typeof value!=='string'||providerDescriptor(value)?.status!=='ADAPTER_IMPLEMENTED')
  throw error('PAYMENT_PROVIDER_NOT_AVAILABLE');
 return value as PaymentProviderId;
}
export function paymentVaultReference(tenantId:string,providerId:PaymentProviderId,
 backend:'MOUNTED'|'GOOGLE',projectId?:string):string{
 id(tenantId,TENANT);provider(providerId);
 if(backend==='MOUNTED')return mountedSecretReference(tenantId,providerId);
 if(!projectId||!/^[a-zA-Z0-9_-]{4,80}$/.test(projectId))
  throw error('PAYMENT_SECRET_PROJECT_INVALID');
 const hash=createHash('sha256').update(tenantId+'\0'+providerId).digest('hex').slice(0,48);
 return 'projects/'+projectId+'/secrets/avpay-'+hash+'/versions/latest';
}
export interface ExternalPaymentVerifier{
 /** May perform a harmless provider-side authenticated check. MUST NOT create a payment. */
 verify(connection:ManagedMerchantConnection,vault:MerchantCredentialsVault):
 Promise<{verified:boolean;evidenceRef:string}>;
}
export class MerchantProviderOnboardingService{
 constructor(private readonly store:MerchantLifecycleStore,private readonly vault:MerchantCredentialsVault,
  private readonly verifier:ExternalPaymentVerifier,private readonly clock:()=>Date=()=>new Date()){}
 async enroll(ctx:TenantContext,raw:unknown){
  if(ctx.role!=='OWNER'||!ctx.userId)throw error('PAYMENT_OWNER_REQUIRED','FORBIDDEN');
  if(!isPlain(raw)||Object.keys(raw).some(k=>!['providerId','recipientId'].includes(k)))
   throw error('PAYMENT_CONNECTION_REQUEST_INVALID');
  const tenant=id(ctx.tenantId,TENANT),p=provider(raw.providerId),recipientId=id(raw.recipientId,RECIPIENT);
  const old=await this.store.get(tenant,p);
  if(old?.status==='ACTIVE')throw error('PAYMENT_ACTIVE_CONNECTION_LOCKED','CONFLICT');
  if(old?.status==='PENDING_VERIFICATION'&&old.recipientId===recipientId)
   return {providerId:p,status:old.status,recipientConfigured:true,credentialConfigured:Boolean(old.credentialRef)};
  const next:ManagedMerchantConnection={tenantId:tenant,providerId:p,recipientId,
   status:'PENDING_VERIFICATION',version:(old?.version??0)+1,updatedAt:this.clock().toISOString()};
  await this.store.write(next,old?.version??0);
  return {providerId:p,status:next.status,recipientConfigured:true,credentialConfigured:false};
 }
 /**
  * OPERATIONS-ONLY: no authenticated merchant API may call this.
  * Secrets must have been provisioned out-of-band with restricted IAM/0600 mount.
  * Never accepts raw credentials or arbitrary secret refs from a tenant.
  */
 async attachVault(tenantId:string,providerId:PaymentProviderId,backend:'MOUNTED'|'GOOGLE',projectId?:string){
  const t=id(tenantId,TENANT),p=provider(providerId),old=await this.store.get(t,p);
  if(!old||old.status!=='PENDING_VERIFICATION'||!old.recipientId)
   throw error('PAYMENT_CONNECTION_NOT_PENDING','CONFLICT');
  const credentialRef=paymentVaultReference(t,p,backend,projectId);
  await this.store.write({...old,credentialRef,updatedAt:this.clock().toISOString(),version:old.version+1},old.version);
 }
 /** OPERATIONS-ONLY: requires an independent provider verification, not an owner checkbox. */
 async verifyAndActivate(tenantId:string,providerId:PaymentProviderId){
  const t=id(tenantId,TENANT),p=provider(providerId),old=await this.store.get(t,p);
  if(!old||old.status!=='PENDING_VERIFICATION'||!old.credentialRef||!old.recipientId)
   throw error('PAYMENT_CONNECTION_NOT_PROVISIONED','CONFLICT');
  const check=await this.verifier.verify(old,this.vault);
  if(check.verified!==true||!/^external:[a-zA-Z0-9._:/-]{10,180}$/.test(check.evidenceRef))
   throw error('PAYMENT_EXTERNAL_VERIFICATION_REQUIRED','CONFLICT');
  const now=this.clock().toISOString();
  await this.store.write({...old,status:'ACTIVE',verifiedAt:now,verificationEvidenceRef:check.evidenceRef,
   updatedAt:now,version:old.version+1},old.version);
 }
 async disable(tenantId:string,providerId:PaymentProviderId){
  const t=id(tenantId,TENANT),p=provider(providerId),old=await this.store.get(t,p);
  if(!old)throw error('PAYMENT_CONNECTION_NOT_FOUND','CONFLICT');
  await this.store.write({...old,status:'DISABLED',updatedAt:this.clock().toISOString(),
   version:old.version+1},old.version);
 }
}
