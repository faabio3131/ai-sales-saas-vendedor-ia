import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {deny,receiptId} from './validation';
import type {AutonomyPolicy,GovernanceRepository,HumanApproval,ToolReceipt,
 TrustedContactConsent} from './model';
import {createHash} from 'node:crypto';

function db(){return getFirestore(ensureFirebaseAdminApp());}
function key(...segments:string[]):string{
 return createHash('sha256').update(JSON.stringify(segments)).digest('hex');
}
const policies=()=>db().collection('governanceUnitPolicies');
const approvals=()=>db().collection('governanceApprovals');
const receipts=()=>db().collection('governanceToolReceipts');
export class FirestoreGovernanceRepository implements GovernanceRepository {
 async getReceipt(t:string,u:string,idempotencyKey:string){
  const doc=await receipts().doc(receiptId({tenantId:t,unitId:u},idempotencyKey)).get();
  const v=doc.data() as ToolReceipt|undefined;
  return v?.tenantId===t&&v.unitId===u&&v.idempotencyKey===idempotencyKey?v:null;
 }
 async getPolicy(t:string,u:string){
  const d=await policies().doc(key(t,u)).get();const v=d.data() as AutonomyPolicy|undefined;
  return v?.tenantId===t&&v.unitId===u?v:null;
 }
 async publishPolicy(next:AutonomyPolicy,expectedVersion:number){
  const ref=policies().doc(key(next.tenantId,next.unitId));
  return db().runTransaction(async tx=>{
   const old=(await tx.get(ref)).data() as AutonomyPolicy|undefined;
   if((old?.version??0)!==expectedVersion)deny('AUTONOMY_POLICY_VERSION_CONFLICT','CONFLICT');
   tx.set(ref,next);return next;
  });
 }
 async createApproval(next:HumanApproval){
  await approvals().doc(next.id).create(next);return next;
 }
 async getApproval(t:string,u:string,id:string){
  const d=await approvals().doc(id).get();const v=d.data() as HumanApproval|undefined;
  return v?.tenantId===t&&v.unitId===u?v:null;
 }
 async revokeApproval(t:string,u:string,id:string,now:string){
  const ref=approvals().doc(id);
  return db().runTransaction(async tx=>{
   const a=(await tx.get(ref)).data() as HumanApproval|undefined;
   if(!a||a.tenantId!==t||a.unitId!==u)deny('AUTONOMY_APPROVAL_NOT_FOUND','NOT_FOUND');
   if(a.status!=='APPROVED')deny('AUTONOMY_APPROVAL_ALREADY_USED','CONFLICT');
   const revoked={...a,status:'REVOKED' as const,revokedAt:now};
   tx.set(ref,revoked);return revoked;
  });
 }
 async reserve(next:ToolReceipt,approvalId:string|undefined,amountMinor:number,now:string){
  const ref=receipts().doc(next.id);const approvalRef=approvalId?approvals().doc(approvalId):null;
  return db().runTransaction(async tx=>{
   const prior=(await tx.get(ref)).data() as ToolReceipt|undefined;
   if(prior){
    if(prior.requestHash!==next.requestHash||prior.actorId!==next.actorId||
       prior.tenantId!==next.tenantId||prior.unitId!==next.unitId)
      deny('AUTONOMY_IDEMPOTENCY_CONFLICT','CONFLICT');
    return {receipt:prior,created:false};
   }
   let grant:HumanApproval|undefined;
   if(approvalRef){
    grant=(await tx.get(approvalRef)).data() as HumanApproval|undefined;
    if(!grant||grant.tenantId!==next.tenantId||grant.unitId!==next.unitId||
      grant.tool!==next.tool||grant.requestHash!==next.requestHash||
      grant.granteeUserId!==next.actorId||grant.status!=='APPROVED'||
      grant.expiresAt<=now||grant.policyVersion!==next.policyVersion||
      grant.maxAmountMinor<amountMinor)
      deny('AUTONOMY_APPROVAL_SCOPE_DENIED');
    tx.set(approvalRef,{...grant,status:'CONSUMED',consumedAt:now});
   }
   tx.create(ref,next);return {receipt:next,created:true};
  });
 }
 async finish(record:ToolReceipt,status:'COMPLETED'|'REVIEW_REQUIRED',now:string,
  result?:Record<string,unknown>,failureCode?:string){
  const ref=receipts().doc(record.id);
  return db().runTransaction(async tx=>{
   const existing=(await tx.get(ref)).data() as ToolReceipt|undefined;
   if(!existing||existing.requestHash!==record.requestHash||
      existing.tenantId!==record.tenantId||existing.unitId!==record.unitId)
    deny('AUTONOMY_RECEIPT_NOT_FOUND','CONFLICT');
   if(existing.status!=='RESERVED')return existing;
   const updated:ToolReceipt={...existing,status,updatedAt:now,
     ...(result!==undefined?{result}:{}),...(failureCode?{failureCode}:{})};
   tx.set(ref,updated);return updated;
  });
 }
}
export interface ContactConsentRepository {
 get(t:string,u:string,c:string):Promise<TrustedContactConsent|null>;
 /** No public API can write this record. Only a signed channel webhook adapter. */
 recordFromVerifiedWebhook(event:TrustedContactConsent):Promise<void>;
}
export class FirestoreContactConsentRepository implements ContactConsentRepository {
 async get(t:string,u:string,c:string){
  const d=await db().collection('governanceTrustedContactConsents').doc(key(t,u,c)).get();
  const a=d.data() as TrustedContactConsent|undefined;
  if(!a||a.tenantId!==t||a.unitId!==u||a.customerId!==c||
    a.channel!=='WHATSAPP'||a.provenance!=='SIGNED_PROVIDER_WEBHOOK'||
    !a.providerEventId||!Number.isFinite(Date.parse(a.recordedAt)))return null;
  return a;
 }
 async recordFromVerifiedWebhook(event:TrustedContactConsent):Promise<void>{
  if(event.provenance!=='SIGNED_PROVIDER_WEBHOOK'||!event.providerEventId||
    !['OPT_IN','OPT_OUT'].includes(event.preference)||
    !/^55\d{10,11}$/.test(event.recipient)||
    !Number.isFinite(Date.parse(event.recordedAt)))deny('AUTONOMY_CONTACT_PROOF_INVALID');
  const ref=db().collection('governanceTrustedContactConsents')
    .doc(key(event.tenantId,event.unitId,event.customerId));
  await db().runTransaction(async tx=>{
   const prev=(await tx.get(ref)).data() as TrustedContactConsent|undefined;
   // Out-of-order webhook retries cannot undo an opt-out.
   if(prev&&(prev.recordedAt>event.recordedAt||
      (prev.recordedAt===event.recordedAt&&prev.preference==='OPT_OUT')))return;
   tx.set(ref,event);
  });
 }
}
export function governanceReceiptKey(t:string,u:string,idempotencyKey:string){
 return receiptId({tenantId:t,unitId:u},idempotencyKey);
}
