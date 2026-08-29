import { randomUUID } from 'crypto';
import { CatalogRepository } from '../catalog/contracts';
import { ApplicationError } from '../infrastructure/errors';
import { PaymentRepository } from '../payments/contracts';
import { PolicyEngine } from '../policies/policyEngine';
import { AutonomyResolver, SafeDefaultAutonomyResolver } from '../sales/service';
import { PolicyEngineInterface } from '../sales/contracts';
import { TenantContext } from '../types/contracts';
import { RevenueExpansionRepository } from './contracts';
import { RevenueExpansion, SuggestExpansionInput } from './model';

export class RevenueExpansionService {
  constructor(
    private readonly expansions: RevenueExpansionRepository,
    private readonly catalog: CatalogRepository,
    private readonly payments: PaymentRepository,
    private readonly policy: PolicyEngineInterface = new PolicyEngine(),
    private readonly autonomy: AutonomyResolver = new SafeDefaultAutonomyResolver(),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private tenant(context: TenantContext): string {
    const tenantId = context.tenantId?.trim();
    if (!tenantId) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
    return tenantId;
  }

  list(context: TenantContext) { return this.expansions.listByTenant(this.tenant(context)); }

  async suggest(context: TenantContext, input: SuggestExpansionInput): Promise<RevenueExpansion> {
    const tenantId = this.tenant(context);
    if (!input.customerId?.trim() || !input.catalogItemId?.trim()) throw new ApplicationError({ category: 'VALIDATION', code: 'EXPANSION_INPUT_INVALID', message: 'Customer and catalog item are required.' });
    if (input.type !== 'UPSELL' && input.type !== 'CROSS_SELL') throw new ApplicationError({ category: 'VALIDATION', code: 'EXPANSION_TYPE_INVALID', message: 'Expansion type is invalid.' });
    const item = await this.catalog.findById(tenantId, input.catalogItemId.trim());
    if (!item || !item.active || item.priceMinor === undefined || item.priceMinor < 0) throw new ApplicationError({ category: 'VALIDATION', code: 'EXPANSION_CATALOG_ITEM_UNAVAILABLE', message: 'Catalog item is not eligible for expansion.' });
    const autonomyMode = await this.autonomy.resolve(tenantId);
    const action = input.type === 'UPSELL' ? 'OFFER_UPSELL' : 'OFFER_CROSS_SELL';
    const policyResult = await this.policy.evaluate({ tenantId, action, autonomyMode });
    if (!policyResult.ok || !policyResult.data) throw new ApplicationError({ category: 'INTERNAL', code: 'EXPANSION_POLICY_FAILED', message: 'Expansion policy evaluation failed.', retryable: true });
    if (!policyResult.data.allowed) throw new ApplicationError({ category: 'FORBIDDEN', code: 'EXPANSION_POLICY_DENIED', message: 'Expansion action is not allowed.' });
    const timestamp = this.now();
    const expansion: RevenueExpansion = {
      id: randomUUID(), tenantId, customerId: input.customerId.trim(), opportunityId: input.opportunityId?.trim() || undefined,
      type: input.type, catalogItemId: item.id, catalogItemName: item.name, suggestedAmountMinor: item.priceMinor, currency: 'BRL',
      reason: input.reason?.trim() || `${input.type} suggestion based on active tenant catalog.`, policyReasonCode: policyResult.data.reasonCode,
      requiresHumanApproval: policyResult.data.requiresHumanApproval, status: policyResult.data.requiresHumanApproval ? 'APPROVAL_REQUIRED' : 'APPROVED',
      createdAt: timestamp, updatedAt: timestamp,
    };
    return this.expansions.create(expansion);
  }

  async approve(context: TenantContext, id: string): Promise<RevenueExpansion> {
    const tenantId = this.tenant(context);
    const expansion = await this.expansions.findById(tenantId, id);
    if (!expansion) throw new ApplicationError({ category: 'NOT_FOUND', code: 'EXPANSION_NOT_FOUND', message: 'Expansion not found.' });
    if (expansion.status === 'ATTRIBUTED' || expansion.status === 'DISMISSED') throw new ApplicationError({ category: 'CONFLICT', code: 'EXPANSION_NOT_APPROVABLE', message: 'Expansion cannot be approved.' });
    if (expansion.status === 'APPROVED') return expansion;
    return this.expansions.update({ ...expansion, status: 'APPROVED', updatedAt: this.now() });
  }

  async attribute(context: TenantContext, id: string, paymentId: string): Promise<RevenueExpansion> {
    const tenantId = this.tenant(context);
    const expansion = await this.expansions.findById(tenantId, id);
    if (!expansion) throw new ApplicationError({ category: 'NOT_FOUND', code: 'EXPANSION_NOT_FOUND', message: 'Expansion not found.' });
    if (expansion.status === 'ATTRIBUTED') {
      if (expansion.attributedPaymentId === paymentId) return expansion;
      throw new ApplicationError({ category: 'CONFLICT', code: 'EXPANSION_ALREADY_ATTRIBUTED', message: 'Expansion is already attributed.' });
    }
    if (expansion.status !== 'APPROVED') throw new ApplicationError({ category: 'CONFLICT', code: 'EXPANSION_NOT_APPROVED', message: 'Expansion must be approved before attribution.' });
    const duplicate = await this.expansions.findByPaymentId(tenantId, paymentId);
    if (duplicate && duplicate.id !== expansion.id) throw new ApplicationError({ category: 'CONFLICT', code: 'PAYMENT_ALREADY_ATTRIBUTED', message: 'Payment is already attributed to another expansion.' });
    const payment = await this.payments.findById(tenantId, paymentId);
    if (!payment || payment.customerId !== expansion.customerId) throw new ApplicationError({ category: 'NOT_FOUND', code: 'EXPANSION_PAYMENT_NOT_FOUND', message: 'Eligible payment not found.' });
    if (payment.status !== 'CONFIRMED') throw new ApplicationError({ category: 'CONFLICT', code: 'PAYMENT_NOT_CONFIRMED', message: 'Only confirmed payments can be attributed.' });
    const timestamp = this.now();
    return this.expansions.update({ ...expansion, status: 'ATTRIBUTED', attributedPaymentId: payment.id, attributedRevenueMinor: payment.amountMinor, attributedAt: timestamp, updatedAt: timestamp });
  }
}
