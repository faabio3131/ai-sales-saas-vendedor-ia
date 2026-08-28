import { randomUUID } from 'crypto';
import { ApplicationError } from '../infrastructure/errors';
import { OpportunityRepository } from '../leads/contracts';
import { Opportunity } from '../leads/model';
import { PolicyEngine } from '../policies/policyEngine';
import { AutonomyMode, PolicyEngineInterface } from '../sales/contracts';
import { TenantContext } from '../types/contracts';
import { RecoveryActionRepository, RecoveryCandidateRepository } from './contracts';
import { RecoveryAction, RecoveryCandidate } from './model';

export interface RecoveryAutonomyResolver {
  resolve(tenantId: string): Promise<AutonomyMode>;
}

export class SafeRecoveryAutonomyResolver implements RecoveryAutonomyResolver {
  async resolve(): Promise<AutonomyMode> { return 'ASSIST'; }
}

function tenant(context: TenantContext): string {
  const id = context.tenantId?.trim();
  if (!id) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return id;
}

function detect(opportunity: Opportunity, now: Date): { reason: string; evidence: string[]; strategy: string } | null {
  if (opportunity.stage === 'FECHADO') return null;
  if (opportunity.stage === 'PERDIDO') {
    return {
      reason: 'LOST_OPPORTUNITY',
      evidence: [`stage:${opportunity.stage}`, ...(opportunity.lostReason ? [`lostReason:${opportunity.lostReason}`] : [])],
      strategy: 'Reabrir contato de forma contextual e validar se a necessidade ainda existe.',
    };
  }
  if (opportunity.stage === 'RECUPERACAO') {
    return { reason: 'RECOVERY_STAGE', evidence: ['stage:RECUPERACAO'], strategy: 'Retomar a negociação a partir do último contexto comercial conhecido.' };
  }
  if (opportunity.nextActionAt) {
    const due = new Date(opportunity.nextActionAt);
    if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) {
      return {
        reason: 'OVERDUE_NEXT_ACTION',
        evidence: [`nextActionAt:${due.toISOString()}`, `stage:${opportunity.stage}`],
        strategy: opportunity.nextAction?.trim() || 'Retomar contato e confirmar a próxima ação comercial.',
      };
    }
  }
  return null;
}

export class RecoveryService {
  constructor(
    private readonly opportunities: OpportunityRepository,
    private readonly candidates: RecoveryCandidateRepository,
    private readonly actions: RecoveryActionRepository,
    private readonly policy: PolicyEngineInterface = new PolicyEngine(),
    private readonly autonomy: RecoveryAutonomyResolver = new SafeRecoveryAutonomyResolver(),
  ) {}

  async list(context: TenantContext): Promise<RecoveryCandidate[]> {
    return this.candidates.listByTenant(tenant(context));
  }

  async detect(context: TenantContext, now = new Date()): Promise<RecoveryCandidate[]> {
    const tenantId = tenant(context);
    const opportunities = await this.opportunities.listByTenant(tenantId);
    const created: RecoveryCandidate[] = [];
    for (const opportunity of opportunities) {
      const signal = detect(opportunity, now);
      if (!signal) continue;
      if (await this.candidates.findOpenByOpportunity(tenantId, opportunity.id)) continue;
      const timestamp = now.toISOString();
      created.push(await this.candidates.create({
        id: randomUUID(), tenantId, customerId: opportunity.customerId, opportunityId: opportunity.id,
        leadId: opportunity.leadId, reason: signal.reason, evidence: signal.evidence, strategy: signal.strategy,
        status: 'OPEN', detectedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
      }));
    }
    return created;
  }

  async prepareAction(context: TenantContext, candidateId: string): Promise<RecoveryAction> {
    const tenantId = tenant(context);
    const id = candidateId?.trim();
    if (!id) throw new ApplicationError({ category: 'VALIDATION', code: 'RECOVERY_CANDIDATE_ID_REQUIRED', message: 'Recovery candidate id is required.' });
    const candidate = await this.candidates.findById(tenantId, id);
    if (!candidate) throw new ApplicationError({ category: 'NOT_FOUND', code: 'RECOVERY_CANDIDATE_NOT_FOUND', message: 'Recovery candidate not found.' });
    if (candidate.status === 'RECOVERED' || candidate.status === 'DISMISSED') {
      throw new ApplicationError({ category: 'CONFLICT', code: 'RECOVERY_CANDIDATE_CLOSED', message: 'Recovery candidate is closed.' });
    }
    const existing = await this.actions.listByCandidate(tenantId, candidate.id);
    const active = existing.find(a => a.status === 'PREPARED' || a.status === 'APPROVAL_REQUIRED' || a.status === 'APPROVED');
    if (active) return active;

    const autonomyMode = await this.autonomy.resolve(tenantId);
    const evaluated = await this.policy.evaluate({ tenantId, action: 'RECOVER', autonomyMode });
    if (!evaluated.ok || !evaluated.data || !evaluated.data.allowed) {
      throw new ApplicationError({ category: 'FORBIDDEN', code: 'RECOVERY_POLICY_BLOCKED', message: 'Recovery action is not allowed by policy.' });
    }
    const timestamp = new Date().toISOString();
    const action = await this.actions.create({
      id: randomUUID(), tenantId, candidateId: candidate.id, customerId: candidate.customerId,
      opportunityId: candidate.opportunityId, strategy: candidate.strategy,
      policyReasonCode: evaluated.data.reasonCode,
      requiresHumanApproval: evaluated.data.requiresHumanApproval,
      status: evaluated.data.requiresHumanApproval ? 'APPROVAL_REQUIRED' : 'PREPARED',
      createdAt: timestamp, updatedAt: timestamp,
    });
    await this.candidates.update({ ...candidate, status: 'ACTION_PREPARED', updatedAt: timestamp });
    return action;
  }
}
