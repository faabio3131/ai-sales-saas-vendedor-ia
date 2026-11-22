export type PlanCode = 'BASIC' | 'STANDARD' | 'PRO' | 'PREMIUM';
export type FeatureCode = 'MULTISECTOR_OPERATIONS' | 'AI_CHAT' | 'CRM_AUTO' | 'FOLLOW_UP' | 'SALES_RECOVERY' | 'QUOTE' | 'UPSELL' | 'CROSS_SELL' | 'CART_RECOVERY' | 'PAYMENTS' | 'AUTONOMOUS_SALES' | 'ADVANCED_ANALYTICS';
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';

export interface PlanDefinition {
  code: PlanCode;
  features: readonly FeatureCode[];
  limits: Readonly<Record<string, number>>;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planCode: PlanCode;
  status: SubscriptionStatus;
  periodStart: string;
  periodEnd: string;
  effectiveLimits?: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

export interface UsageCounter {
  id: string;
  tenantId: string;
  metric: string;
  periodKey: string;
  value: number;
  createdAt: string;
  updatedAt: string;
}
