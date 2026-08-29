import { ApplicationError } from '../infrastructure/errors';
import { LeadRepository, OpportunityRepository } from '../leads/contracts';
import { FUNNEL_STAGES } from '../leads/model';
import { FollowUpRepository } from '../followups/contracts';
import { RecoveryCandidateRepository } from '../recovery/contracts';
import { TenantContext } from '../types/contracts';
import { AttentionItem, DashboardSnapshot } from './model';

export class DashboardService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly followUps: FollowUpRepository,
    private readonly recovery: RecoveryCandidateRepository,
  ) {}

  async snapshot(context: TenantContext, now = new Date()): Promise<DashboardSnapshot> {
    const tenantId = context.tenantId?.trim();
    if (!tenantId) {
      throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
    }
    const nowIso = now.toISOString();
    const [leads, opportunities, dueFollowUps, recoveryCandidates] = await Promise.all([
      this.leads.listByTenant(tenantId),
      this.opportunities.listByTenant(tenantId),
      this.followUps.listDue(tenantId, nowIso),
      this.recovery.listByTenant(tenantId),
    ]);

    const openOpportunities = opportunities.filter((item) => item.stage !== 'FECHADO' && item.stage !== 'PERDIDO');
    const recoveryOpen = recoveryCandidates.filter((item) => item.status === 'OPEN' || item.status === 'ACTION_PREPARED');
    const attention: AttentionItem[] = [
      ...dueFollowUps.map((item) => ({
        kind: 'FOLLOW_UP_DUE' as const,
        entityId: item.id,
        customerId: item.customerId,
        opportunityId: item.opportunityId,
        dueAt: item.scheduledAt,
        reason: item.reason,
      })),
      ...openOpportunities
        .filter((item) => item.nextActionAt && item.nextActionAt <= nowIso)
        .map((item) => ({
          kind: 'OPPORTUNITY_DUE' as const,
          entityId: item.id,
          customerId: item.customerId,
          opportunityId: item.id,
          dueAt: item.nextActionAt,
          reason: item.nextAction || 'Opportunity requires attention.',
        })),
      ...recoveryOpen.map((item) => ({
        kind: 'RECOVERY_OPEN' as const,
        entityId: item.id,
        customerId: item.customerId,
        opportunityId: item.opportunityId,
        reason: item.reason,
      })),
    ].sort((a, b) => {
      const aDueAt = 'dueAt' in a && a.dueAt ? a.dueAt : nowIso;
      const bDueAt = 'dueAt' in b && b.dueAt ? b.dueAt : nowIso;
      return aDueAt.localeCompare(bDueAt);
    });

    const funnel: DashboardSnapshot['metrics']['funnel'] = {};
    for (const stage of FUNNEL_STAGES) {
      const count = leads.filter((lead) => lead.stage === stage).length;
      if (count > 0) funnel[stage] = count;
    }

    return {
      tenantId,
      generatedAt: nowIso,
      attention,
      metrics: {
        leadsTotal: leads.length,
        opportunitiesOpen: openOpportunities.length,
        pipelineValueMinor: openOpportunities.reduce((total, item) => total + (item.estimatedValueMinor ?? 0), 0),
        followUpsDue: dueFollowUps.length,
        recoveryOpen: recoveryOpen.length,
        funnel,
      },
    };
  }
}
