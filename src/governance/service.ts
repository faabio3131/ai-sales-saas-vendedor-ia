import {randomUUID} from 'node:crypto';
import type {TenantContext} from '../types/contracts';
import {requireBusinessAdmin,requireBusinessScope} from '../business/service';
import {deny,hashRequest,receiptId,strict,validatePolicy,validateToolRequest,ID} from './validation';
import type {AutonomyPolicy,GovernanceRepository,GovernedToolPorts,HumanApproval,
 ToolReceipt,ToolRequest} from './model';
export class GovernedAutonomyService{
 constructor(private readonly store:GovernanceRepository,private readonly ports:GovernedToolPorts,
  private readonly clock:()=>Date=()=>new Date()){}
 private scope(ctx:TenantContext,unitId:string){
  if(!ctx.userId?.trim()||!['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF','CASHIER'].includes(ctx.role??''))
   deny('AUTONOMY_ACTOR_FORBIDDEN');
  return requireBusinessScope(ctx,unitId);
 }
 async policy(ctx:TenantContext,unitId:string):Promise<AutonomyPolicy>{
  const s=this.scope(ctx,unitId);
  return await this.store.getPolicy(s.tenantId,s.unitId)??{
   ...s,version:0,mode:'ASSIST',allowedTools:[],
   maxOrderMinor:0,maxPaymentMinor:0,updatedAt:'',updatedBy:'',
  };
 }
 async publish(ctx:TenantContext,unitId:string,payload:unknown){
  const next=validatePolicy(ctx,unitId,payload,this.clock().toISOString());
  return this.store.publishPolicy(next,next.version-1);
 }
 async approve(ctx:TenantContext,unitId:string,input:unknown):Promise<HumanApproval>{
  requireBusinessAdmin(ctx);
  const s=this.scope(ctx,unitId);
  strict(input,['command','granteeUserId','maxAmountMinor','expiresAt']);
  const command=validateToolRequest(input.command);
  if(command.approvalId)deny('AUTONOMY_APPROVAL_NESTING_FORBIDDEN','VALIDATION');
  if(typeof input.granteeUserId!=='string'||!ID.test(input.granteeUserId)||
    !Number.isSafeInteger(input.maxAmountMinor)||Number(input.maxAmountMinor)<0||
    Number(input.maxAmountMinor)>100_000_000||
    typeof input.expiresAt!=='string')
    deny('AUTONOMY_APPROVAL_INVALID','VALIDATION');
  const now=this.clock();
  const expires=new Date(input.expiresAt);
  if(!Number.isFinite(expires.getTime())||expires.getTime()<=now.getTime()||
    expires.getTime()-now.getTime()>3600000)
    deny('AUTONOMY_APPROVAL_EXPIRY_INVALID','VALIDATION');
  const policy=await this.policy(ctx,unitId);
  if(!policy.allowedTools.includes(command.tool))deny('AUTONOMY_APPROVAL_TOOL_NOT_ALLOWED');
  const a:HumanApproval={id:'grant_'+randomUUID().replace(/-/g,''),
   ...s,tool:command.tool,requestHash:hashRequest(s,command),
   granteeUserId:input.granteeUserId,approvedBy:ctx.userId!,policyVersion:policy.version,
   maxAmountMinor:Number(input.maxAmountMinor),expiresAt:expires.toISOString(),
   createdAt:now.toISOString(),status:'APPROVED'};
  return this.store.createApproval(a);
 }
 async revoke(ctx:TenantContext,unitId:string,approvalId:string){
  requireBusinessAdmin(ctx);
  const s=this.scope(ctx,unitId);
  if(!ID.test(approvalId))deny('AUTONOMY_APPROVAL_ID_INVALID','VALIDATION');
  return this.store.revokeApproval(s.tenantId,s.unitId,approvalId,this.clock().toISOString());
 }
 async approval(ctx:TenantContext,unitId:string,approvalId:string){
  requireBusinessAdmin(ctx);
  const s=this.scope(ctx,unitId);
  if(!ID.test(approvalId))deny('AUTONOMY_APPROVAL_ID_INVALID','VALIDATION');
  const a=await this.store.getApproval(s.tenantId,s.unitId,approvalId);
  if(!a)deny('AUTONOMY_APPROVAL_NOT_FOUND','NOT_FOUND');
  return a;
 }
 async execute(ctx:TenantContext,unitId:string,raw:unknown):Promise<ToolReceipt>{
  const s=this.scope(ctx,unitId);
  const command=validateToolRequest(raw);
  if(command.tool==='RECOVERY_PREPARE'&&
     !['OWNER','ADMIN','MANAGER','ATTENDANT'].includes(ctx.role??''))
   deny('AUTONOMY_RECOVERY_ROLE_DENIED');
  // A committed receipt wins over any later state/policy changes: retrying a
  // confirmed order or payment never creates a second operation.
  const previous=await this.store.getReceipt(s.tenantId,s.unitId,command.idempotencyKey);
  if(previous){
   if(previous.requestHash!==hashRequest(s,command)||previous.actorId!==ctx.userId||
     previous.tool!==command.tool)deny('AUTONOMY_IDEMPOTENCY_CONFLICT','CONFLICT');
   if(previous.status!=='COMPLETED')deny('AUTONOMY_REPLAY_REQUIRES_HUMAN_REVIEW','CONFLICT');
   return previous;
  }
  const policy=await this.policy(ctx,unitId);
  if(!policy.allowedTools.includes(command.tool))deny('AUTONOMY_TOOL_NOT_ENABLED');
  const p=command.payload;
  const orderId=typeof p.orderId==='string'?p.orderId:undefined;
  const canonical=orderId?await this.ports.orderStatus(s,orderId):undefined;
  if(canonical&&(canonical.tenantId!==s.tenantId||canonical.unitId!==s.unitId))
   deny('AUTONOMY_ORDER_SCOPE_DENIED');
  const amount=canonical?.totalMinor??0;
  if(canonical&&(!Number.isSafeInteger(amount)||amount<=0||
    canonical.status==='CANCELLED'))deny('AUTONOMY_ORDER_INVALID');
  if(command.tool==='ORDER_CONFIRM'){
   if(canonical?.status!=='DRAFT'||canonical.version!==p.expectedVersion||
     (p.confirmation as Record<string,unknown>).totalMinor!==amount)
    deny('AUTONOMY_CONFIRMATION_STALE','CONFLICT');
   if(!await this.ports.verifyTrustedInbound(s.tenantId,s.unitId,orderId!,
     String((p.confirmation as Record<string,unknown>).evidenceRef)))
    deny('AUTONOMY_CUSTOMER_CHANNEL_UNVERIFIED');
  }
  if(['PAYMENT_CREATE','PRODUCTION_RELEASE'].includes(command.tool)){
   if(canonical?.status!=='CONFIRMED')deny('AUTONOMY_CONFIRMED_ORDER_REQUIRED');
   // Historical confirmation must also be corroborated by immutable signed
   // inbound evidence. A user-authored CRM message cannot unlock automation.
   if(!await this.ports.verifyTrustedInbound(s.tenantId,s.unitId,orderId!,
     await this.confirmationRef(s,orderId!)))
    deny('AUTONOMY_CUSTOMER_CHANNEL_UNVERIFIED');
  }
  if(orderId&&command.tool!=='ORDER_STATUS'){
   const signals=await this.ports.riskSignals(s.tenantId,s.unitId,orderId);
   if(signals.length)deny('AUTONOMY_RISK_ESCALATION_REQUIRED');
  }
  if(command.tool==='RECOVERY_PREPARE'){
   const customerId=await this.ports.recoveryCustomer(s.tenantId,String(p.candidateId));
   if(!customerId)deny('AUTONOMY_RECOVERY_CANDIDATE_NOT_FOUND','NOT_FOUND');
   const consent=await this.ports.contactConsent(s.tenantId,s.unitId,customerId);
   if(!consent||consent.tenantId!==s.tenantId||consent.unitId!==s.unitId||
     consent.customerId!==customerId||consent.channel!=='WHATSAPP'||
     consent.provenance!=='SIGNED_PROVIDER_WEBHOOK'||consent.preference!=='OPT_IN')
     deny('AUTONOMY_RECOVERY_CONSENT_REQUIRED');
  }
  const write=command.tool!=='ORDER_STATUS';
  const requiresApproval=write&&(
   policy.mode!=='AUTONOMOUS_GOVERNED'||
   (command.tool==='PAYMENT_CREATE'?amount>policy.maxPaymentMinor:
    command.tool==='ORDER_DRAFT'?policy.maxOrderMinor===0:
    amount>policy.maxOrderMinor)
  );
  if(requiresApproval&&!command.approvalId)deny('AUTONOMY_HUMAN_APPROVAL_REQUIRED');
  if(!requiresApproval&&command.approvalId)deny('AUTONOMY_SUPERFLUOUS_APPROVAL','VALIDATION');
  // An approval never lifts the hard constraints above, and a configuration
  // change never grants the model privileged tools or modifies operationMode.
  const now=this.clock().toISOString();
  const receipt:ToolReceipt={id:receiptId(s,command.idempotencyKey),...s,
   actorId:ctx.userId!,tool:command.tool,idempotencyKey:command.idempotencyKey,
   policyVersion:policy.version,requestHash:hashRequest(s,command),
   status:'RESERVED',createdAt:now,updatedAt:now,
   ...(command.approvalId?{approvalId:command.approvalId}:{})};
  const reservation=await this.store.reserve(receipt,
   requiresApproval?command.approvalId:undefined,amount,now);
  if(!reservation.created){
   if(reservation.receipt.status!=='COMPLETED')
    deny('AUTONOMY_REPLAY_REQUIRES_HUMAN_REVIEW','CONFLICT');
   return reservation.receipt;
  }
  try{
   // Revocation committed before dispatch blocks the operation. Once a side
   // effect starts, revocation cannot undo it; reconciliation remains mandatory.
   const current=await this.policy(ctx,unitId);
   if(current.version!==policy.version||!current.allowedTools.includes(command.tool))
    deny('AUTONOMY_POLICY_VERSION_CONFLICT','CONFLICT');
   const result=await this.dispatch(ctx,unitId,command,canonical,policy);
   const finalized=await this.store.finish(receipt,'COMPLETED',this.clock().toISOString(),result);
   if(finalized.status!=='COMPLETED')deny('AUTONOMY_EXECUTION_UNCERTAIN','CONFLICT');
   return finalized;
  }catch{
   // Never reissue an uncertain side effect. A secondary persistence outage
   // leaves RESERVED for the dedicated quarantine worker, not for retry.
   try{
    await this.store.finish(receipt,'REVIEW_REQUIRED',this.clock().toISOString(),
     undefined,'AUTONOMY_EXECUTION_UNCERTAIN');
   }catch{ /* Durable RESERVED is quarantined by the scheduled recovery worker. */ }
   deny('AUTONOMY_EXECUTION_UNCERTAIN','CONFLICT');
  }
 }
 private async confirmationRef(s:{tenantId:string;unitId:string},orderId:string){
  // The T03/T04 canonical order is authoritative for customer confirmation.
  const order=await this.ports.orderStatus(s,orderId);
  const evidence=order.customerConfirmation;
  if(!evidence?.evidenceRef)deny('AUTONOMY_CONFIRMED_ORDER_REQUIRED');
  return evidence.evidenceRef;
 }
 private async dispatch(ctx:TenantContext,u:string,command:ToolRequest,
  order?:{id:string;totalMinor:number},policy?:AutonomyPolicy):Promise<Record<string,unknown>>{
  const p=command.payload;
  if(command.tool==='ORDER_STATUS'){
   if(!order)deny('AUTONOMY_ORDER_NOT_FOUND','NOT_FOUND');
   return {orderId:order.id,totalMinor:order.totalMinor,
     status:(order as {status?:string}).status??'UNKNOWN',
     paymentState:(order as {paymentState?:string}).paymentState??'UNKNOWN',
     productionState:(order as {productionState?:string}).productionState??'UNKNOWN'};
  }
  if(command.tool==='ORDER_DRAFT'){
   const created=await this.ports.draft(ctx,u,p,'gov_'+command.idempotencyKey);
   const total=created.totalMinor;
   if(!Number.isSafeInteger(total)||Number(total)<=0)
    deny('AUTONOMY_DRAFT_TOTAL_INVALID');
   // Draft only; exceeding the autonomous limit cannot create payment/release.
   return {orderId:created.id,totalMinor:total,version:created.version,
     status:created.status,requiresAmountReview:Number(total)>(policy?.maxOrderMinor??0)};
  }
  if(command.tool==='ORDER_CONFIRM'){
   const confirmed=await this.ports.confirm(ctx,u,p);
   return {orderId:confirmed.id,version:confirmed.version,status:confirmed.status};
  }
  if(command.tool==='PAYMENT_CREATE'){
   const payment=await this.ports.payment(ctx,u,p,'gov_'+command.idempotencyKey);
   return {orderId:p.orderId,paymentId:payment.id,status:payment.status,
     method:payment.method,version:payment.version};
  }
  if(command.tool==='PRODUCTION_RELEASE'){
   const operation=await this.ports.release(ctx,u,String(p.orderId));
   return {orderId:p.orderId,operationVersion:operation.version,
     state:operation.state,operationMode:operation.operationMode};
  }
  if(command.tool==='RECOVERY_PREPARE'){
   const action=await this.ports.recovery(ctx,String(p.candidateId));
   return {recoveryActionId:action.id,status:action.status,
     outboundSent:false};
  }
  return deny('AUTONOMY_TOOL_NOT_ALLOWLISTED');
 }
}
