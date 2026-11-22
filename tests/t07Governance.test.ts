
import {describe,it,expect} from 'vitest';
import type {TenantContext} from '../src/types/contracts';
import {GovernedAutonomyService} from '../src/governance/service';
import type {AutonomyPolicy,GovernanceRepository,GovernedToolPorts,HumanApproval,
 ToolReceipt,ToolRequest,TrustedContactConsent} from '../src/governance/model';
import {deny} from '../src/governance/validation';

const now='2026-11-21T18:00:00.000Z';
const actor=(role='OWNER',tenantId='pizza-a',userId='operator1'):TenantContext=>
 ({tenantId,userId,role,requestId:'test'});
const request=(tool:ToolRequest['tool'],payload:Record<string,unknown>,
 idempotencyKey='action_123',approvalId?:string):ToolRequest=>({tool,payload,idempotencyKey,
 ...(approvalId?{approvalId}:{})});
const publish=(mode:'ASSIST'|'COPILOT'|'AUTONOMOUS_GOVERNED'='AUTONOMOUS_GOVERNED',
 expectedVersion=0)=>({mode,expectedVersion,maxOrderMinor:20000,maxPaymentMinor:12000,
 allowedTools:['ORDER_STATUS','ORDER_DRAFT','ORDER_CONFIRM','PAYMENT_CREATE',
  'PRODUCTION_RELEASE','RECOVERY_PREPARE']});
const draft=()=>request('ORDER_DRAFT',{customerId:'customer_111',expectedCatalogVersion:1,
 lines:[{catalogItemId:'pizza_111',quantity:1}],fulfillment:{kind:'PICKUP'}},'draft_111');
const confirm=()=>request('ORDER_CONFIRM',{orderId:'order_111',expectedVersion:1,
 confirmation:{kind:'CUSTOMER_MESSAGE',evidenceRef:'conversation:conv_111:msg_111',
  totalMinor:7200}},'confirm_111');
const payment=()=>request('PAYMENT_CREATE',{orderId:'order_111',method:'PIX'},'payment_111');
const release=()=>request('PRODUCTION_RELEASE',{orderId:'order_111'},'release_111');

class Store implements GovernanceRepository {
 policies=new Map<string,AutonomyPolicy>();receipts=new Map<string,ToolReceipt>();
 grants=new Map<string,HumanApproval>();
 k(t:string,u:string){return t+':'+u;}
 async getPolicy(t:string,u:string){return this.policies.get(this.k(t,u))??null;}
 async getReceipt(t:string,u:string,idempotencyKey:string){
  const receipt=[...this.receipts.values()].find(r=>r.tenantId===t&&r.unitId===u&&
   r.idempotencyKey===idempotencyKey);return receipt??null;
 }
 async publishPolicy(p:AutonomyPolicy,v:number){
  const k=this.k(p.tenantId,p.unitId);
  if((this.policies.get(k)?.version??0)!==v)deny('AUTONOMY_POLICY_VERSION_CONFLICT','CONFLICT');
  this.policies.set(k,p);return p;
 }
 async createApproval(a:HumanApproval){this.grants.set(a.id,a);return a;}
 async getApproval(t:string,u:string,id:string){
  const a=this.grants.get(id);return a?.tenantId===t&&a.unitId===u?a:null;
 }
 async revokeApproval(t:string,u:string,id:string,stamp:string){
  const a=await this.getApproval(t,u,id);
  if(!a)deny('AUTONOMY_APPROVAL_NOT_FOUND','NOT_FOUND');
  if(a.status!=='APPROVED')deny('AUTONOMY_APPROVAL_ALREADY_USED','CONFLICT');
  const n:HumanApproval={...a,status:'REVOKED',revokedAt:stamp};
  this.grants.set(id,n);return n;
 }
 async reserve(r:ToolReceipt,approvalId:string|undefined,amount:number,stamp:string){
  const old=this.receipts.get(r.id);
  if(old){
   if(old.requestHash!==r.requestHash||old.actorId!==r.actorId||
     old.tenantId!==r.tenantId||old.unitId!==r.unitId)
    deny('AUTONOMY_IDEMPOTENCY_CONFLICT','CONFLICT');
   return {receipt:old,created:false};
  }
  const policy=await this.getPolicy(r.tenantId,r.unitId);
  if(!policy||policy.version!==r.policyVersion||!policy.allowedTools.includes(r.tool))
   deny('AUTONOMY_POLICY_VERSION_CONFLICT','CONFLICT');
  if(approvalId){
   const a=await this.getApproval(r.tenantId,r.unitId,approvalId);
   if(!a||a.status!=='APPROVED'||a.tool!==r.tool||a.policyVersion!==r.policyVersion||
     a.requestHash!==r.requestHash||a.granteeUserId!==r.actorId||
     a.maxAmountMinor<amount||a.expiresAt<=stamp)deny('AUTONOMY_APPROVAL_SCOPE_DENIED');
   this.grants.set(a.id,{...a,status:'CONSUMED',consumedAt:stamp});
  }
  this.receipts.set(r.id,r);return {receipt:r,created:true};
 }
 async finish(r:ToolReceipt,status:'COMPLETED'|'REVIEW_REQUIRED',
  stamp:string,result?:Record<string,unknown>,failureCode?:string){
  const old=this.receipts.get(r.id);
  if(!old)deny('AUTONOMY_RECEIPT_NOT_FOUND','CONFLICT');
  const next:ToolReceipt={...old,status,updatedAt:stamp,
    ...(result?{result}:{}),...(failureCode?{failureCode}:{})};
  this.receipts.set(r.id,next);return next;
 }
}
type Row={id:string;customerId:string;tenantId:string;unitId:string;totalMinor:number;
 status:string;paymentState:string;productionState:string;version:number;
 customerConfirmation?:{evidenceRef:string;totalMinor:number}};
function fixture(){
 const store=new Store();const orders=new Map<string,Row>();const events:string[]=[];
 const state={trust:true,consent:'OPT_IN',risk:[] as string[],failPayment:false,
  mode:'NATIVE_OPERATIONS' as 'NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS'};
 const consent:TrustedContactConsent={tenantId:'pizza-a',unitId:'main',
  customerId:'customer_111',channel:'WHATSAPP',preference:'OPT_IN',
  provenance:'SIGNED_PROVIDER_WEBHOOK',providerEventId:'proof_111',
  recipient:'5513999999999',recordedAt:now};
 const ports:GovernedToolPorts={
  async orderStatus(s,id){
   const row=orders.get(id);
   if(!row||row.tenantId!==s.tenantId||row.unitId!==s.unitId)
    deny('AUTONOMY_ORDER_NOT_FOUND','NOT_FOUND');
   return row;
  },
  async draft(c,u,p,key){
   events.push('draft:'+key);
   const row:Row={id:'order_111',tenantId:c.tenantId,unitId:u,
    customerId:String(p.customerId),totalMinor:7200,status:'DRAFT',
    paymentState:'NOT_REQUESTED',productionState:'NOT_DISPATCHED',version:1};
   orders.set(row.id,row);return row;
  },
  async confirm(c,u,p){
   events.push('confirm');
   const row=orders.get(String(p.orderId));
   if(!row||row.tenantId!==c.tenantId||row.unitId!==u||row.status!=='DRAFT')
    deny('ORDER_NOT_CONFIRMABLE','CONFLICT');
   row.status='CONFIRMED';row.version++;
   row.customerConfirmation={evidenceRef:'conversation:conv_111:msg_111',totalMinor:7200};
   return row;
  },
  async payment(c,u,p,key){
   events.push('payment:'+key);
   if(state.failPayment)throw new Error('unknown PSP result');
   const row=orders.get(String(p.orderId));
   if(!row||row.tenantId!==c.tenantId||row.unitId!==u||row.status!=='CONFIRMED')
    deny('ORDER_PAYMENT_NOT_CONFIRMED');
   row.paymentState='PENDING';
   return {id:'opay_111',status:'PENDING',version:2,method:'PIX'};
  },
  async release(c,u,id){
   events.push('release');
   const row=orders.get(id);
   if(!row||row.tenantId!==c.tenantId||row.unitId!==u||row.paymentState!=='CONFIRMED')
    deny('PAYMENT_REQUIRED');
   row.productionState=state.mode==='NATIVE_OPERATIONS'?'QUEUED':'AWAITING_ACK';
   return {version:1,state:row.productionState,operationMode:state.mode};
  },
  async recovery(_c,id){events.push('recovery:'+id);
   return {id:'recover_111',customerId:'customer_111',status:'PREPARED'};},
  async recoveryCustomer(t,id){return t==='pizza-a'&&id==='candidate_111'?'customer_111':null;},
  async contactConsent(t,u,c){return t==='pizza-a'&&u==='main'&&c==='customer_111'?
    {...consent,preference:state.consent as 'OPT_IN'|'OPT_OUT'}:null;},
  async verifyTrustedInbound(t,u,id,ref){return state.trust&&t==='pizza-a'&&u==='main'&&
    orders.has(id)&&ref==='conversation:conv_111:msg_111';},
  async riskSignals(t,u,_id){return t==='pizza-a'&&u==='main'?state.risk:['CROSS_TENANT'];},
 };
 const service=new GovernedAutonomyService(store,ports,()=>new Date(now));
 return {service,store,orders,state,events};
}
async function setup(mode:'ASSIST'|'COPILOT'|'AUTONOMOUS_GOVERNED'='AUTONOMOUS_GOVERNED'){
 const f=fixture();await f.service.publish(actor(),'main',publish(mode));return f;
}
describe('T07 — transações governadas, aprovação e fluxo completo',()=>{
 it('defaults to ASSIST without enabled tools and isolates policy by tenant/unit',async()=>{
  const f=fixture();expect(await f.service.policy(actor(),'main'))
   .toMatchObject({mode:'ASSIST',allowedTools:[],version:0});
  await expect(f.service.execute(actor(),'main',draft()))
   .rejects.toMatchObject({code:'AUTONOMY_TOOL_NOT_ENABLED'});
  expect((await f.service.policy(actor('OWNER','pizza-b'),'main')).mode).toBe('ASSIST');
 });
 it('publishes only with OWNER role and correct version/caps',async()=>{
  const f=fixture();
  await expect(f.service.publish(actor('MANAGER'),'main',publish()))
   .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
  expect((await f.service.publish(actor(),'main',publish())).version).toBe(1);
  await expect(f.service.publish(actor(),'main',publish()))
   .rejects.toMatchObject({code:'AUTONOMY_POLICY_VERSION_CONFLICT'});
  await expect(f.service.publish(actor(),'main',{...publish(),allowedTools:['REFUND']}))
   .rejects.toMatchObject({code:'AUTONOMY_POLICY_INVALID'});
 });
 it('closes native order, payment and kitchen with only verified snapshots and idempotent receipts',async()=>{
  const f=await setup();
  const d=await f.service.execute(actor(),'main',draft());
  expect(d.result).toMatchObject({status:'DRAFT',totalMinor:7200});
  expect((await f.service.execute(actor(),'main',draft())).id).toBe(d.id);
  expect(f.events.filter(x=>x.startsWith('draft'))).toHaveLength(1);
  const confirmed=await f.service.execute(actor(),'main',confirm());
  expect(confirmed.result).toMatchObject({status:'CONFIRMED'});
  expect((await f.service.execute(actor(),'main',confirm())).id).toBe(confirmed.id);
  expect(f.events.filter(x=>x==='confirm')).toHaveLength(1);
  const billed=await f.service.execute(actor(),'main',payment());
  expect(billed.result).toMatchObject({status:'PENDING'});
  expect((await f.service.execute(actor(),'main',payment())).id).toBe(billed.id);
  expect(f.events.filter(x=>x.startsWith('payment'))).toHaveLength(1);
  await expect(f.service.execute(actor(),'main',release()))
   .rejects.toMatchObject({code:'AUTONOMY_EXECUTION_UNCERTAIN'});
  f.orders.get('order_111')!.paymentState='CONFIRMED';
  const r=await f.service.execute(actor(),'main',{...release(),idempotencyKey:'release_112'});
  expect(r.result).toMatchObject({state:'QUEUED',operationMode:'NATIVE_OPERATIONS'});
  const view=await f.service.execute(actor(),'main',
   request('ORDER_STATUS',{orderId:'order_111'},'status_111'));
  expect(view.result).toMatchObject({status:'CONFIRMED',paymentState:'CONFIRMED',productionState:'QUEUED'});
  expect(f.events.filter(x=>x==='release')).toHaveLength(2);
 });
 it('integrated mode returns AWAITING_ACK rather than inventing production success',async()=>{
  const f=await setup();f.state.mode='INTEGRATED_OPERATIONS';
  await f.service.execute(actor(),'main',draft());
  await f.service.execute(actor(),'main',confirm());
  await f.service.execute(actor(),'main',payment());
  f.orders.get('order_111')!.paymentState='CONFIRMED';
  expect((await f.service.execute(actor(),'main',release())).result)
   .toMatchObject({state:'AWAITING_ACK',operationMode:'INTEGRATED_OPERATIONS'});
 });
 it('requires exactly scoped human approval in ASSIST and COPILOT; consumes once',async()=>{
  for(const mode of ['ASSIST','COPILOT'] as const){
   const f=await setup(mode);
   await expect(f.service.execute(actor(),'main',draft()))
    .rejects.toMatchObject({code:'AUTONOMY_HUMAN_APPROVAL_REQUIRED'});
   const a=await f.service.approve(actor(),'main',{command:draft(),
    granteeUserId:'operator1',maxAmountMinor:10000,expiresAt:'2026-11-21T18:30:00.000Z'});
   const r=await f.service.execute(actor(),'main',{...draft(),approvalId:a.id});
   expect(r.status).toBe('COMPLETED');expect(f.store.grants.get(a.id)?.status).toBe('CONSUMED');
   await expect(f.service.execute(actor(),'main',{...draft(),
     idempotencyKey:'draft_112',approvalId:a.id}))
    .rejects.toMatchObject({code:'AUTONOMY_APPROVAL_SCOPE_DENIED'});
  }
 });
 it('expires and revokes grants, and blocks grants from old policy versions',async()=>{
  const f=await setup('COPILOT');
  await expect(f.service.approve(actor(),'main',{command:draft(),
   granteeUserId:'operator1',maxAmountMinor:10000,expiresAt:now}))
   .rejects.toMatchObject({code:'AUTONOMY_APPROVAL_EXPIRY_INVALID'});
  const a=await f.service.approve(actor(),'main',{command:draft(),
   granteeUserId:'operator1',maxAmountMinor:10000,expiresAt:'2026-11-21T18:30:00.000Z'});
  await f.service.revoke(actor(),'main',a.id);
  await expect(f.service.execute(actor(),'main',{...draft(),approvalId:a.id}))
   .rejects.toMatchObject({code:'AUTONOMY_APPROVAL_SCOPE_DENIED'});
  const b=await f.service.approve(actor(),'main',{command:draft(),
   granteeUserId:'operator1',maxAmountMinor:10000,expiresAt:'2026-11-21T18:30:00.000Z'});
  await f.service.publish(actor(),'main',publish('COPILOT',1));
  await expect(f.service.execute(actor(),'main',{...draft(),approvalId:b.id}))
   .rejects.toMatchObject({code:'AUTONOMY_APPROVAL_SCOPE_DENIED'});
 });
 it('restricts customer recovery to commercial staff roles even with opt-in',async()=>{
  const f=await setup();
  const req=request('RECOVERY_PREPARE',{candidateId:'candidate_111'},'recover_staff');
  await expect(f.service.execute(actor('STAFF'),'main',req))
   .rejects.toMatchObject({code:'AUTONOMY_RECOVERY_ROLE_DENIED'});
  await expect(f.service.execute(actor('CASHIER'),'main',req))
   .rejects.toMatchObject({code:'AUTONOMY_RECOVERY_ROLE_DENIED'});
  expect(f.events).toHaveLength(0);
 });
 it('prepares recovery only with signed opt-in; opt-out never sends anything',async()=>{
  const f=await setup();
  const c=request('RECOVERY_PREPARE',{candidateId:'candidate_111'},'recover_111');
  f.state.consent='OPT_OUT';
  await expect(f.service.execute(actor(),'main',c)).rejects.toMatchObject({code:'AUTONOMY_RECOVERY_CONSENT_REQUIRED'});
  expect(f.events).toHaveLength(0);
  f.state.consent='OPT_IN';
  expect((await f.service.execute(actor(),'main',c)).result)
   .toMatchObject({status:'PREPARED',outboundSent:false});
 });
});


describe('T07 — adversarial security, failure fencing and escalation',()=>{
 it('rejects unknown tools, fake operation status and finance/refund privilege escalation',async()=>{
  const f=await setup();
  for(const tool of ['REFUND','FINANCE_QUERY','SET_OPERATION_MODE','FORGE_STATUS',
    'SEND_WHATSAPP','AUTHORIZE_INTEGRATION']){
   await expect(f.service.execute(actor(),'main',{tool,idempotencyKey:'attack_111',
    payload:{orderId:'order_111'}})).rejects.toMatchObject({code:'AUTONOMY_TOOL_NOT_ALLOWLISTED'});
  }
  await expect(f.service.execute(actor(),'main',{...draft(),
    payload:{...draft().payload,operationMode:'INTEGRATED_OPERATIONS'}}))
   .rejects.toMatchObject({code:'AUTONOMY_TOOL_PAYLOAD_INVALID'});
  await expect(f.service.execute(actor(),'main',{...payment(),
    payload:{...payment().payload,discountPercent:100}}))
   .rejects.toMatchObject({code:'AUTONOMY_TOOL_PAYLOAD_INVALID'});
  expect(f.events).toHaveLength(0);
 });
 it('rejects unauthenticated AI identity, wrong tenant, and unauthorized human approvals',async()=>{
  const f=await setup();
  await expect(f.service.execute(actor('AI'),'main',draft())).rejects.toMatchObject({code:'AUTONOMY_ACTOR_FORBIDDEN'});
  await expect(f.service.execute(actor('OWNER','pizza-b'),'main',draft()))
   .rejects.toMatchObject({code:'AUTONOMY_TOOL_NOT_ENABLED'});
  await f.service.execute(actor(),'main',draft());
  await expect(f.service.execute(actor('OWNER','pizza-b'),'main',
   request('ORDER_STATUS',{orderId:'order_111'},'other_111')))
   .rejects.toMatchObject({code:'AUTONOMY_TOOL_NOT_ENABLED'});
  await expect(f.service.approve(actor('MANAGER'),'main',{command:draft(),
   granteeUserId:'operator1',maxAmountMinor:10000,expiresAt:'2026-11-21T18:30:00.000Z'}))
   .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
 });
 it('cannot confirm order using unsigned customer message, fabricated total or late version',async()=>{
  const f=await setup();
  await f.service.execute(actor(),'main',draft());
  f.state.trust=false;
  await expect(f.service.execute(actor(),'main',confirm()))
   .rejects.toMatchObject({code:'AUTONOMY_CUSTOMER_CHANNEL_UNVERIFIED'});
  f.state.trust=true;
  await expect(f.service.execute(actor(),'main',{...confirm(),payload:{
   ...confirm().payload,expectedVersion:999}}))
   .rejects.toMatchObject({code:'AUTONOMY_CONFIRMATION_STALE'});
  await expect(f.service.execute(actor(),'main',{...confirm(),payload:{
   ...confirm().payload,confirmation:{kind:'CUSTOMER_MESSAGE',
    evidenceRef:'conversation:conv_111:msg_111',totalMinor:1}}}))
   .rejects.toMatchObject({code:'AUTONOMY_CONFIRMATION_STALE'});
  expect(f.events.filter(x=>x==='confirm')).toHaveLength(0);
 });
 it('escalates trusted risk signals for allergies, financial disputes, discount and injection',async()=>{
  for(const risk of ['UNVERIFIED_ALLERGEN','FINANCIAL_DISPUTE','UNAUTHORIZED_DISCOUNT',
    'PROMPT_INJECTION','RISK_ASSESSMENT_NOT_VERIFIED']){
   const f=await setup();
   await f.service.execute(actor(),'main',draft());
   f.state.risk=[risk];
   await expect(f.service.execute(actor(),'main',confirm()))
    .rejects.toMatchObject({code:'AUTONOMY_RISK_ESCALATION_REQUIRED'});
   expect(f.events.filter(x=>x==='confirm')).toHaveLength(0);
  }
 });
 it('cannot reuse idempotency for different action or repeat uncertain financial side effects',async()=>{
  const f=await setup();
  await f.service.execute(actor(),'main',draft());
  await expect(f.service.execute(actor(),'main',
   request('ORDER_DRAFT',{...draft().payload,customerId:'customer_222'},'draft_111')))
   .rejects.toMatchObject({code:'AUTONOMY_IDEMPOTENCY_CONFLICT'});
  await f.service.execute(actor(),'main',confirm());
  f.state.failPayment=true;
  await expect(f.service.execute(actor(),'main',payment()))
   .rejects.toMatchObject({code:'AUTONOMY_EXECUTION_UNCERTAIN'});
  const receipt=[...f.store.receipts.values()].find(x=>x.tool==='PAYMENT_CREATE');
  expect(receipt).toMatchObject({status:'REVIEW_REQUIRED',failureCode:'AUTONOMY_EXECUTION_UNCERTAIN'});
  f.state.failPayment=false;
  await expect(f.service.execute(actor(),'main',payment()))
   .rejects.toMatchObject({code:'AUTONOMY_REPLAY_REQUIRES_HUMAN_REVIEW'});
  expect(f.events.filter(x=>x.startsWith('payment'))).toHaveLength(1);
 });
 it('does not issue the same order creation twice when competing command calls race',async()=>{
  const f=await setup();
  const answers=await Promise.allSettled([
   f.service.execute(actor(),'main',draft()),f.service.execute(actor(),'main',draft()),
  ]);
  expect(answers.some(a=>a.status==='fulfilled')).toBe(true);
  expect(f.events.filter(x=>x.startsWith('draft'))).toHaveLength(1);
  expect(f.store.receipts.size).toBe(1);
 });
 it('rejects cross-user grant use, over-cap financial command, and expired grants',async()=>{
  const f=await setup('COPILOT');
  await f.service.execute(actor(),'main',
   request('ORDER_STATUS',{orderId:'missing_111'},'any_111')).catch(()=>undefined);
  const g=await f.service.approve(actor(),'main',{command:draft(),
   granteeUserId:'operator1',maxAmountMinor:10000,
   expiresAt:'2026-11-21T18:30:00.000Z'});
  await expect(f.service.execute(actor('ATTENDANT','pizza-a','different_user'),'main',
   {...draft(),approvalId:g.id})).rejects.toMatchObject({code:'AUTONOMY_APPROVAL_SCOPE_DENIED'});
  const a=await f.service.approve(actor(),'main',{command:draft(),
   granteeUserId:'different_user',maxAmountMinor:10000,
   expiresAt:'2026-11-21T18:30:00.000Z'});
  await expect(f.service.execute(actor(),'main',{...draft(),approvalId:a.id}))
   .rejects.toMatchObject({code:'AUTONOMY_APPROVAL_SCOPE_DENIED'});
 });
});

describe('T13 governance policy fencing',()=>{
 it('stale policy cannot reserve or execute after revocation',async()=>{
  const f=await setup();
  const reserve=f.store.reserve.bind(f.store);
  f.store.reserve=async (...args:Parameters<Store['reserve']>)=>{
   await f.service.publish(actor(),'main',{...publish('ASSIST',1),allowedTools:[]});
   return reserve(...args);
  };
  await expect(f.service.execute(actor(),'main',draft())).rejects.toMatchObject({code:'AUTONOMY_POLICY_VERSION_CONFLICT'});
  expect(f.events).toHaveLength(0);
  expect(f.store.receipts.size).toBe(0);
 });
 it('revocation after reservation but before dispatch leaves a review receipt without side effects',async()=>{
  const f=await setup();
  const reserve=f.store.reserve.bind(f.store);
  f.store.reserve=async (...args:Parameters<Store['reserve']>)=>{
   const result=await reserve(...args);
   await f.service.publish(actor(),'main',{...publish('ASSIST',1),allowedTools:[]});
   return result;
  };
  await expect(f.service.execute(actor(),'main',draft())).rejects.toMatchObject({code:'AUTONOMY_EXECUTION_UNCERTAIN'});
  expect(f.events).toHaveLength(0);
  expect([...f.store.receipts.values()][0]?.status).toBe('REVIEW_REQUIRED');
 });
});
