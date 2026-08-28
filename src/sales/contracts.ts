import { Result } from '../types/contracts';

export const SALES_ACTIONS = [
  'RESPOND','QUALIFY','FOLLOW_UP','CREATE_QUOTE','REQUEST_HUMAN','RECOVER',
  'OFFER_UPSELL','OFFER_CROSS_SELL','CREATE_PAYMENT','NO_ACTION',
] as const;
export type SalesAction = (typeof SALES_ACTIONS)[number];
export type AutonomyMode = 'ASSIST' | 'COPILOT' | 'AUTONOMOUS';

export interface SalesContext {
  tenantId: string;
  customerId: string;
  leadId: string;
  opportunityId?: string;
  stage: string;
  interest?: string;
  purchaseIntent?: string;
  urgency?: string;
  objection?: string;
  sentiment?: string;
  nextAction?: string;
  confidence?: number;
  autonomyMode: AutonomyMode;
}

export interface SalesDecision {
  action: SalesAction;
  reason: string;
  requiresHumanApproval: boolean;
  allowed: boolean;
  policyReasonCode: string;
  confidence?: number;
  source: 'DETERMINISTIC' | 'AI_SUGGESTED';
}

export interface SalesEngineInterface {
  decide(context: SalesContext): Promise<Result<SalesDecision>>;
}

export interface PolicyEvaluationInput {
  tenantId: string;
  action: SalesAction;
  autonomyMode: AutonomyMode;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresHumanApproval: boolean;
  reasonCode: string;
  effectiveLimits: Record<string, unknown>;
}

export interface PolicyEngineInterface {
  evaluate(input: PolicyEvaluationInput): Promise<Result<PolicyDecision>>;
}
