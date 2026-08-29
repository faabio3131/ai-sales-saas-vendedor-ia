import { describe, expect, it } from 'vitest';
import { DashboardService } from '../src/dashboard/service';
import { FollowUpRepository } from '../src/followups/contracts';
import { FollowUp } from '../src/followups/model';
import { LeadRepository, OpportunityRepository } from '../src/leads/contracts';
import { Lead, Opportunity } from '../src/leads/model';
import { RecoveryCandidateRepository } from '../src/recovery/contracts';
import { RecoveryCandidate } from '../src/recovery/model';

class LeadsRepo implements LeadRepository {
  constructor(private items: Lead[]) {}
  async listByTenant(t: string) { return this.items.filter(x => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find(x => x.tenantId === t && x.id === id) ?? null; }
  async findActiveByCustomer(t: string, c: string) { return this.items.find(x => x.tenantId === t && x.customerId === c) ?? null; }
  async create(x: Lead) { this.items.push(x); return x; }
  async update(x: Lead) { return x; }
}
class OppRepo implements OpportunityRepository {
  constructor(private items: Opportunity[]) {}
  async listByTenant(t: string) { return this.items.filter(x => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find(x => x.tenantId === t && x.id === id) ?? null; }
  async create(x: Opportunity) { this.items.push(x); return x; }
  async update(x: Opportunity) { return x; }
}
class FollowRepo implements FollowUpRepository {
  constructor(private items: FollowUp[]) {}
  async listByTenant(t: string) { return this.items.filter(x => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find(x => x.tenantId === t && x.id === id) ?? null; }
  async findByIdempotencyKey(t: string, k: string) { return this.items.find(x => x.tenantId === t && x.idempotencyKey === k) ?? null; }
  async listDue(t: string, due: string) { return this.items.filter(x => x.tenantId === t && ['SCHEDULED','RETRY'].includes(x.status) && x.scheduledAt <= due); }
  async create(x: FollowUp) { this.items.push(x); return x; }
  async update(x: FollowUp) { return x; }
}
class RecoveryRepo implements RecoveryCandidateRepository {
  constructor(private items: RecoveryCandidate[]) {}
  async listByTenant(t: string) { return this.items.filter(x => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find(x => x.tenantId === t && x.id === id) ?? null; }
  async findOpenByOpportunity(t: string, o: string) { return this.items.find(x => x.tenantId === t && x.opportunityId === o) ?? null; }
  async create(x: RecoveryCandidate) { this.items.push(x); return x; }
  async update(x: RecoveryCandidate) { return x; }
}

const now = new Date('2026-08-28T20:00:00.000Z');
const lead = (id: string, tenantId: string, stage: Lead['stage']): Lead => ({ id, tenantId, customerId: `c-${id}`, stage, createdAt: now.toISOString(), updatedAt: now.toISOString() });
const opp = (id: string, tenantId: string, stage: Opportunity['stage'], value?: number, due?: string): Opportunity => ({ id, tenantId, customerId: `c-${id}`, stage, currency: 'BRL', estimatedValueMinor: value, nextAction: 'Contact customer', nextActionAt: due, createdAt: now.toISOString(), updatedAt: now.toISOString() });

describe('BLK-130 Dashboard / Analytics', () => {
  it('calculates deterministic tenant-scoped commercial metrics', async () => {
    const service = new DashboardService(
      new LeadsRepo([lead('1','a','QUALIFICADO'), lead('2','a','PROPOSTA'), lead('x','b','FECHADO')]),
      new OppRepo([opp('1','a','PROPOSTA',10000), opp('2','a','FECHADO',5000), opp('x','b','PROPOSTA',999999)]),
      new FollowRepo([]), new RecoveryRepo([]),
    );
    const result = await service.snapshot({ tenantId: 'a', requestId: 'r1' }, now);
    expect(result.metrics).toMatchObject({ leadsTotal: 2, opportunitiesOpen: 1, pipelineValueMinor: 10000 });
    expect(result.metrics.funnel).toEqual({ QUALIFICADO: 1, PROPOSTA: 1 });
  });

  it('builds today attention from due follow-up, opportunity and recovery', async () => {
    const due = '2026-08-28T19:00:00.000Z';
    const follow: FollowUp = { id:'f1',tenantId:'a',customerId:'c1',opportunityId:'o1',status:'SCHEDULED',reason:'No reply',scheduledAt:due,attempt:0,idempotencyKey:'k',createdAt:due,updatedAt:due };
    const recovery: RecoveryCandidate = { id:'r1',tenantId:'a',customerId:'c2',opportunityId:'o2',reason:'Abandoned opportunity',evidence:['waiting'],strategy:'Re-engage',status:'OPEN',detectedAt:due,createdAt:due,updatedAt:due };
    const service = new DashboardService(new LeadsRepo([]), new OppRepo([opp('o1','a','AGUARDANDO_CLIENTE',2000,due)]), new FollowRepo([follow]), new RecoveryRepo([recovery]));
    const result = await service.snapshot({ tenantId:'a',requestId:'r' }, now);
    expect(result.metrics.followUpsDue).toBe(1);
    expect(result.metrics.recoveryOpen).toBe(1);
    expect(result.attention.map(x => x.kind)).toEqual(expect.arrayContaining(['FOLLOW_UP_DUE','OPPORTUNITY_DUE','RECOVERY_OPEN']));
  });

  it('excludes closed/lost opportunities from pipeline', async () => {
    const service = new DashboardService(new LeadsRepo([]), new OppRepo([opp('1','a','FECHADO',1000),opp('2','a','PERDIDO',2000)]), new FollowRepo([]), new RecoveryRepo([]));
    const result = await service.snapshot({ tenantId:'a',requestId:'r' }, now);
    expect(result.metrics.opportunitiesOpen).toBe(0);
    expect(result.metrics.pipelineValueMinor).toBe(0);
  });

  it('fails closed without tenant context', async () => {
    const service = new DashboardService(new LeadsRepo([]), new OppRepo([]), new FollowRepo([]), new RecoveryRepo([]));
    await expect(service.snapshot({ tenantId:'',requestId:'r' }, now)).rejects.toMatchObject({ code:'TENANT_CONTEXT_REQUIRED' });
  });

  it('never includes data from another tenant in attention', async () => {
    const due = '2026-08-28T19:00:00.000Z';
    const foreign: FollowUp = { id:'foreign',tenantId:'b',customerId:'cb',status:'SCHEDULED',reason:'foreign',scheduledAt:due,attempt:0,idempotencyKey:'k2',createdAt:due,updatedAt:due };
    const service = new DashboardService(new LeadsRepo([]), new OppRepo([]), new FollowRepo([foreign]), new RecoveryRepo([]));
    const result = await service.snapshot({ tenantId:'a',requestId:'r' }, now);
    expect(result.attention).toHaveLength(0);
    expect(result.metrics.followUpsDue).toBe(0);
  });
});
