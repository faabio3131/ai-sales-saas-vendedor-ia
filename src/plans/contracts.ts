import { FeatureCode, PlanDefinition, Subscription, UsageCounter } from './model';

export interface SubscriptionRepository {
  findByTenant(tenantId: string): Promise<Subscription | null>;
  upsert(subscription: Subscription): Promise<Subscription>;
}

export interface UsageRepository {
  find(tenantId: string, metric: string, periodKey: string): Promise<UsageCounter | null>;
  upsert(counter: UsageCounter): Promise<UsageCounter>;
}

export interface FeatureEntitlementServiceInterface {
  canUse(tenantId: string, feature: FeatureCode): Promise<boolean>;
  getLimits(tenantId: string): Promise<Record<string, number>>;
  getPlan(tenantId: string): Promise<PlanDefinition>;
}
