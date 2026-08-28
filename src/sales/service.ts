import { AIRouterInterface } from '../ai/contracts';
import { ApplicationError } from '../infrastructure/errors';
import { LeadRepository, OpportunityRepository } from '../leads/contracts';
import { PolicyEngine } from '../policies/policyEngine';
import { TenantContext } from '../types/contracts';
import { AutonomyMode, PolicyEngineInterface, SalesDecision } from './contracts';
import { SalesEngine } from './engine';

export interface AutonomyResolver {
  resolve(tenantId: string): Promise<AutonomyMode>;
}

export class SafeDefaultAutonomyResolver implements AutonomyResolver {
  async resolve(): Promise<AutonomyMode> { return 'ASSIST'; }
}

export class SalesDecisionService {
  private readonly engine: SalesEngine;

  constructor(
    private readonly leads: LeadRepository,
    private readonly opportunities: OpportunityRepository,
    policy: PolicyEngineInterface = new PolicyEngine(),
    ai?: AIRouterInterface,
    private readonly autonomy: AutonomyResolver = new SafeDefaultAutonomyResolver(),
  ) {
    this.engine = new SalesEngine(policy, ai);
  }

  async decide(context: TenantContext, input: { leadId: string; opportunityId?: string }): Promise<SalesDecision> {
    const tenantId = context.tenantId?.trim();
    if (!tenantId) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
    const leadId = input.leadId?.trim();
    if (!leadId) throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_ID_REQUIRED', message: 'Lead id is required.' });
    const lead = await this.leads.findById(tenantId, leadId);
    if (!lead) throw new ApplicationError({ category: 'NOT_FOUND', code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });

    let opportunityId: string | undefined;
    if (input.opportunityId?.trim()) {
      const opportunity = await this.opportunities.findById(tenantId, input.opportunityId.trim());
      if (!opportunity || opportunity.customerId !== lead.customerId || (opportunity.leadId && opportunity.leadId !== lead.id)) {
        throw new ApplicationError({ category: 'NOT_FOUND', code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
      }
      opportunityId = opportunity.id;
    }

    const autonomyMode = await this.autonomy.resolve(tenantId);
    const result = await this.engine.decide({
      tenantId,
      customerId: lead.customerId,
      leadId: lead.id,
      opportunityId,
      stage: lead.stage,
      interest: lead.interest,
      purchaseIntent: lead.purchaseIntent,
      urgency: lead.urgency,
      objection: lead.objection,
      sentiment: lead.sentiment,
      nextAction: lead.nextAction,
      confidence: lead.confidence,
      autonomyMode,
    });
    if (!result.ok || !result.data) {
      throw new ApplicationError({
        category: result.error?.category ?? 'INTERNAL',
        code: result.error?.code ?? 'SALES_DECISION_FAILED',
        message: result.error?.message ?? 'Sales decision failed.',
        retryable: result.error?.retryable,
      });
    }
    return result.data;
  }
}
