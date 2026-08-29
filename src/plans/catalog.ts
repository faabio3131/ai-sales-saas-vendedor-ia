import { PlanCode, PlanDefinition } from './model';

const PLAN_CATALOG: Record<PlanCode, PlanDefinition> = {
  BASIC: { code:'BASIC', features:['AI_CHAT','CRM_AUTO','QUOTE'], limits:{ aiActionsPerMonth:500, followUpsPerMonth:0, recoveryActionsPerMonth:0 } },
  STANDARD: { code:'STANDARD', features:['AI_CHAT','CRM_AUTO','FOLLOW_UP','QUOTE','PAYMENTS'], limits:{ aiActionsPerMonth:2000, followUpsPerMonth:500, recoveryActionsPerMonth:0 } },
  PRO: { code:'PRO', features:['AI_CHAT','CRM_AUTO','FOLLOW_UP','SALES_RECOVERY','QUOTE','UPSELL','CROSS_SELL','PAYMENTS'], limits:{ aiActionsPerMonth:10000, followUpsPerMonth:3000, recoveryActionsPerMonth:1000 } },
  PREMIUM: { code:'PREMIUM', features:['AI_CHAT','CRM_AUTO','FOLLOW_UP','SALES_RECOVERY','QUOTE','UPSELL','CROSS_SELL','CART_RECOVERY','PAYMENTS','AUTONOMOUS_SALES','ADVANCED_ANALYTICS'], limits:{ aiActionsPerMonth:50000, followUpsPerMonth:15000, recoveryActionsPerMonth:5000 } },
};

export function getPlanDefinition(code: PlanCode): PlanDefinition {
  return PLAN_CATALOG[code];
}
