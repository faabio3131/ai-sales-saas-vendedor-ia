import type {AutonomyMode} from '../sales/contracts';

export const GOVERNED_TOOLS = [
  'ORDER_STATUS','ORDER_DRAFT','ORDER_CONFIRM','PAYMENT_CREATE',
  'PRODUCTION_RELEASE','RECOVERY_PREPARE',
] as const;
export type GovernedTool = typeof GOVERNED_TOOLS[number];
export type GovernedMode = Exclude<AutonomyMode,'AUTONOMOUS'>;
export type GovernedStatus = 'RESERVED'|'COMPLETED'|'REVIEW_REQUIRED';

export interface AutonomyPolicy {
  tenantId:string;unitId:string;version:number;mode:GovernedMode;
  allowedTools:GovernedTool[];maxOrderMinor:number;maxPaymentMinor:number;
  updatedAt:string;updatedBy:string;
}
export interface PublishAutonomyPolicy {
  expectedVersion:number;mode:GovernedMode;allowedTools:GovernedTool[];
  maxOrderMinor:number;maxPaymentMinor:number;
}
export interface ToolRequest {
  tool:GovernedTool;idempotencyKey:string;payload:Record<string,unknown>;
  approvalId?:string;
}
export interface ToolReceipt {
  id:string;tenantId:string;unitId:string;actorId:string;tool:GovernedTool;
  requestHash:string;idempotencyKey:string;policyVersion:number;
  status:GovernedStatus;createdAt:string;updatedAt:string;
  result?:Record<string,unknown>;failureCode?:string;approvalId?:string;
}
export interface HumanApproval {
  id:string;tenantId:string;unitId:string;tool:GovernedTool;requestHash:string;
  granteeUserId:string;approvedBy:string;policyVersion:number;maxAmountMinor:number;
  expiresAt:string;createdAt:string;status:'APPROVED'|'CONSUMED'|'REVOKED';
  consumedAt?:string;revokedAt?:string;
}
export interface TrustedContactConsent {
  tenantId:string;unitId:string;customerId:string;channel:'WHATSAPP';
  preference:'OPT_IN'|'OPT_OUT';provenance:'SIGNED_PROVIDER_WEBHOOK';
  providerEventId:string;recordedAt:string;recipient:string;
}
export interface GovernanceRepository {
  getPolicy(tenantId:string,unitId:string):Promise<AutonomyPolicy|null>;
  publishPolicy(next:AutonomyPolicy,expectedVersion:number):Promise<AutonomyPolicy>;
  createApproval(next:HumanApproval):Promise<HumanApproval>;
  getApproval(tenantId:string,unitId:string,id:string):Promise<HumanApproval|null>;
  revokeApproval(tenantId:string,unitId:string,id:string,now:string):Promise<HumanApproval>;
  reserve(next:ToolReceipt,approvalId:string|undefined,amountMinor:number,now:string):
    Promise<{receipt:ToolReceipt;created:boolean}>;
  finish(receipt:ToolReceipt,status:'COMPLETED'|'REVIEW_REQUIRED',
    now:string,result?:Record<string,unknown>,failureCode?:string):Promise<ToolReceipt>;
}
export interface GovernedToolPorts {
  orderStatus(scope:{tenantId:string;unitId:string},orderId:string):Promise<{
    id:string;customerId:string;tenantId:string;unitId:string;totalMinor:number;
    customerConfirmation?:{evidenceRef:string;totalMinor:number};
    status:string;paymentState:string;productionState:string;version:number;
  }>;
  draft(ctx:import('../types/contracts').TenantContext,unitId:string,payload:Record<string,unknown>,
    idempotencyKey:string):Promise<{id:string;totalMinor:number;version:number;status:string}>;
  confirm(ctx:import('../types/contracts').TenantContext,unitId:string,payload:Record<string,unknown>):
    Promise<{id:string;version:number;status:string}>;
  payment(ctx:import('../types/contracts').TenantContext,unitId:string,payload:Record<string,unknown>,
    idempotencyKey:string):Promise<{id:string;version:number;status:string;method:string}>;
  release(ctx:import('../types/contracts').TenantContext,unitId:string,orderId:string):
    Promise<{version:number;state:string;operationMode:string}>;
  recovery(ctx:import('../types/contracts').TenantContext,candidateId:string):
    Promise<{id:string;customerId:string;status:string}>;
  recoveryCustomer(tenantId:string,candidateId:string):Promise<string|null>;
  contactConsent(tenantId:string,unitId:string,customerId:string):Promise<TrustedContactConsent|null>;
  verifyTrustedInbound(tenantId:string,unitId:string,orderId:string,reference:string):
    Promise<boolean>;
  riskSignals(tenantId:string,unitId:string,orderId:string):Promise<readonly string[]>;
}
