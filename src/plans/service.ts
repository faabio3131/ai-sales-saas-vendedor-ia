import { ApplicationError } from '../infrastructure/errors';
import { FeatureEntitlementServiceInterface, SubscriptionRepository, UsageRepository } from './contracts';
import { getPlanDefinition } from './catalog';
import { FeatureCode, PlanDefinition, UsageCounter } from './model';

export class FeatureEntitlementService implements FeatureEntitlementServiceInterface {
  constructor(private readonly subscriptions: SubscriptionRepository) {}

  private async activeSubscription(tenantId: string) {
    if (!tenantId?.trim()) throw new ApplicationError({ category:'FORBIDDEN', code:'TENANT_CONTEXT_REQUIRED', message:'Tenant context is required.' });
    const subscription = await this.subscriptions.findByTenant(tenantId);
    if (!subscription || subscription.status !== 'ACTIVE') throw new ApplicationError({ category:'FORBIDDEN', code:'SUBSCRIPTION_INACTIVE', message:'Active subscription required.' });
    const now = Date.now();
    if (Date.parse(subscription.periodStart) > now || Date.parse(subscription.periodEnd) < now) throw new ApplicationError({ category:'FORBIDDEN', code:'SUBSCRIPTION_OUT_OF_PERIOD', message:'Subscription is outside its active period.' });
    return subscription;
  }

  async getPlan(tenantId: string): Promise<PlanDefinition> {
    const subscription = await this.activeSubscription(tenantId);
    return getPlanDefinition(subscription.planCode);
  }

  async canUse(tenantId: string, feature: FeatureCode): Promise<boolean> {
    const plan = await this.getPlan(tenantId);
    return plan.features.includes(feature);
  }

  async getLimits(tenantId: string): Promise<Record<string, number>> {
    const subscription = await this.activeSubscription(tenantId);
    return { ...getPlanDefinition(subscription.planCode).limits, ...(subscription.effectiveLimits ?? {}) };
  }
}

export class UsageService {
  constructor(private readonly usage: UsageRepository, private readonly entitlements: FeatureEntitlementServiceInterface, private readonly now:()=>string=()=>new Date().toISOString()) {}

  async get(tenantId:string, metric:string, periodKey:string): Promise<UsageCounter | null> {
    return this.usage.find(tenantId, metric, periodKey);
  }

  async increment(tenantId:string, metric:string, periodKey:string, amount=1, limitKey?:string): Promise<UsageCounter> {
    if (!tenantId?.trim() || !metric?.trim() || !periodKey?.trim() || !Number.isInteger(amount) || amount <= 0) throw new ApplicationError({ category:'VALIDATION', code:'USAGE_INPUT_INVALID', message:'Usage input is invalid.' });
    const limits = await this.entitlements.getLimits(tenantId);
    const existing = await this.usage.find(tenantId, metric, periodKey);
    const nextValue = (existing?.value ?? 0) + amount;
    if (limitKey && limits[limitKey] !== undefined && nextValue > limits[limitKey]) throw new ApplicationError({ category:'FORBIDDEN', code:'USAGE_LIMIT_EXCEEDED', message:'Plan usage limit exceeded.' });
    const timestamp = this.now();
    return this.usage.upsert(existing ? { ...existing, value:nextValue, updatedAt:timestamp } : { id:`${tenantId}_${periodKey}_${metric}`, tenantId, metric, periodKey, value:nextValue, createdAt:timestamp, updatedAt:timestamp });
  }
}
