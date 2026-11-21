import { describe, expect, it, vi } from 'vitest';
import { AIRouterInterface } from '../src/ai/contracts';
import { LeadRepository, OpportunityRepository } from '../src/leads/contracts';
import { Lead, Opportunity } from '../src/leads/model';
import { PolicyEngine } from '../src/policies/policyEngine';
import { SalesEngine } from '../src/sales/engine';
import { SalesDecisionService, AutonomyResolver } from '../src/sales/service';
import { TenantContext } from '../src/types/contracts';

const now = '2026-08-28T23:00:00.000Z';
const ctx = (tenantId: string): TenantContext => ({ tenantId, requestId: `req-${tenantId}`, userId: 'user-1' });

class LeadsMemory implements LeadRepository {
  constructor(public items: Lead[]) {}
  async listByTenant(t: string) { return this.items.filter((x) => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find((x) => x.tenantId === t && x.id === id) ?? null; }
  async findActiveByCustomer(t: string, c: string) { return this.items.find((x) => x.tenantId === t && x.customerId === c) ?? null; }
  async create(x: Lead) { this.items.push(x); return x; }
  async update(x: Lead) { return x; }
}
class OppsMemory implements OpportunityRepository {
  constructor(public items: Opportunity[] = []) {}
  async listByTenant(t: string) { return this.items.filter((x) => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find((x) => x.tenantId === t && x.id === id) ?? null; }
  async create(x: Opportunity) { this.items.push(x); return x; }
  async update(x: Opportunity) { return x; }
}
class FixedAutonomy implements AutonomyResolver {
  constructor(private readonly mode: 'ASSIST'|'COPILOT'|'AUTONOMOUS') {}
  async resolve() { return this.mode; }
}

const lead = (stage: Lead['stage'] = 'QUALIFICADO'): Lead => ({
  id:'lead-a', tenantId:'tenant-a', customerId:'customer-a', stage,
  interest:'Plano Pro', createdAt:now, updatedAt:now,
});

describe('BLK-090: Sales Engine', () => {
  it('uses deterministic next action and forces approval in ASSIST mode', async () => {
    const engine = new SalesEngine(new PolicyEngine());
    const result = await engine.decide({ tenantId:'tenant-a', customerId:'customer-a', leadId:'lead-a', stage:'QUALIFICADO', autonomyMode:'ASSIST' });
    expect(result).toMatchObject({ ok:true, data:{ action:'CREATE_QUOTE', allowed:true, requiresHumanApproval:true, source:'DETERMINISTIC' } });
  });

  it('allows safe actions without approval in COPILOT mode', async () => {
    const engine = new SalesEngine(new PolicyEngine());
    const result = await engine.decide({ tenantId:'tenant-a', customerId:'customer-a', leadId:'lead-a', stage:'PROPOSTA', autonomyMode:'COPILOT' });
    expect(result).toMatchObject({ ok:true, data:{ action:'FOLLOW_UP', requiresHumanApproval:false, policyReasonCode:'COPILOT_SAFE_ACTION' } });
  });

  it('keeps CREATE_PAYMENT human-approved even in AUTONOMOUS mode', async () => {
    const ai: AIRouterInterface = {
      resolveProvider: vi.fn(),
      execute: vi.fn(async () => ({ ok:true, data:{ provider:'fake', model:'fake-1', structuredData:{ action:'CREATE_PAYMENT', reason:'Customer asked to pay now.', confidence:0.9 } } })),
    };
    const engine = new SalesEngine(new PolicyEngine(), ai);
    const result = await engine.decide({ tenantId:'tenant-a', customerId:'customer-a', leadId:'lead-a', stage:'QUALIFICADO', autonomyMode:'AUTONOMOUS' });
    expect(result).toMatchObject({ ok:true, data:{ action:'CREATE_PAYMENT', allowed:false, requiresHumanApproval:true, policyReasonCode:'CONFIRMED_ORDER_REQUIRED', source:'AI_SUGGESTED' } });
  });

  it('falls back safely when AI throws or returns invalid output', async () => {
    const ai: AIRouterInterface = {
      resolveProvider: vi.fn(),
      execute: vi.fn(async () => { throw new Error('provider private failure'); }),
    };
    const engine = new SalesEngine(new PolicyEngine(), ai);
    const result = await engine.decide({ tenantId:'tenant-a', customerId:'customer-a', leadId:'lead-a', stage:'NOVO', autonomyMode:'ASSIST' });
    expect(result).toMatchObject({ ok:true, data:{ action:'QUALIFY', source:'DETERMINISTIC' } });
    expect(JSON.stringify(result)).not.toContain('private failure');
  });

  it('sales decision service enforces tenant scoped lead access', async () => {
    const service = new SalesDecisionService(new LeadsMemory([lead()]), new OppsMemory(), new PolicyEngine(), undefined, new FixedAutonomy('ASSIST'));
    await expect(service.decide(ctx('tenant-b'), { leadId:'lead-a' })).rejects.toMatchObject({ code:'LEAD_NOT_FOUND' });
  });

  it('does not trust autonomy mode from request payload; resolver is server-side authority', async () => {
    const service = new SalesDecisionService(new LeadsMemory([lead('PROPOSTA')]), new OppsMemory(), new PolicyEngine(), undefined, new FixedAutonomy('ASSIST'));
    const decision = await service.decide(ctx('tenant-a'), { leadId:'lead-a' });
    expect(decision.action).toBe('FOLLOW_UP');
    expect(decision.requiresHumanApproval).toBe(true);
    expect(decision.policyReasonCode).toBe('ASSIST_MODE_REQUIRES_APPROVAL');
  });
});
