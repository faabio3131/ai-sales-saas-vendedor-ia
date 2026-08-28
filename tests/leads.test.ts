import { describe, expect, it, vi } from 'vitest';
import { AIRouterInterface } from '../src/ai/contracts';
import { ConversationRepository } from '../src/conversations/contracts';
import { Conversation } from '../src/conversations/model';
import { CustomerRepository } from '../src/customers/contracts';
import { Customer } from '../src/customers/model';
import { LeadRepository, OpportunityRepository } from '../src/leads/contracts';
import { Lead, Opportunity } from '../src/leads/model';
import { LeadService, validateLeadCandidate } from '../src/leads/service';
import { TenantContext } from '../src/types/contracts';

const ctx = (tenantId: string): TenantContext => ({ tenantId, requestId: `req-${tenantId}`, userId: 'user-1' });
const now = '2026-08-28T23:00:00.000Z';

class LeadsMemory implements LeadRepository {
  items: Lead[] = [];
  async listByTenant(t: string) { return this.items.filter((x) => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find((x) => x.tenantId === t && x.id === id) ?? null; }
  async findActiveByCustomer(t: string, c: string) { return this.items.find((x) => x.tenantId === t && x.customerId === c && !['FECHADO','PERDIDO'].includes(x.stage)) ?? null; }
  async create(x: Lead) { this.items.push(x); return x; }
  async update(x: Lead) { this.items = this.items.map((i) => i.id === x.id && i.tenantId === x.tenantId ? x : i); return x; }
}
class OppsMemory implements OpportunityRepository {
  items: Opportunity[] = [];
  async listByTenant(t: string) { return this.items.filter((x) => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find((x) => x.tenantId === t && x.id === id) ?? null; }
  async create(x: Opportunity) { this.items.push(x); return x; }
  async update(x: Opportunity) { this.items = this.items.map((i) => i.id === x.id && i.tenantId === x.tenantId ? x : i); return x; }
}
class CustomersMemory implements CustomerRepository {
  constructor(public items: Customer[]) {}
  async listByTenant(t: string) { return this.items.filter((x) => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find((x) => x.tenantId === t && x.id === id) ?? null; }
  async findByExternalIdentity() { return null; }
  async create(x: Customer) { this.items.push(x); return x; }
  async update(x: Customer) { return x; }
}
class ConversationsMemory implements ConversationRepository {
  constructor(public items: Conversation[]) {}
  async listByTenant(t: string) { return this.items.filter((x) => x.tenantId === t); }
  async findById(t: string, id: string) { return this.items.find((x) => x.tenantId === t && x.id === id) ?? null; }
  async findByExternalConversationId() { return null; }
  async create(x: Conversation) { this.items.push(x); return x; }
  async update(x: Conversation) { return x; }
}

function fixture(ai?: AIRouterInterface) {
  const leads = new LeadsMemory(); const opps = new OppsMemory();
  const customers = new CustomersMemory([
    { id:'c-a',tenantId:'tenant-a',name:'Cliente A',externalIdentities:[],status:'ACTIVE',createdAt:now,updatedAt:now },
    { id:'c-b',tenantId:'tenant-b',name:'Cliente B',externalIdentities:[],status:'ACTIVE',createdAt:now,updatedAt:now },
  ]);
  const conversations = new ConversationsMemory([
    { id:'conv-a',tenantId:'tenant-a',customerId:'c-a',channel:'WEB',status:'OPEN',handlingMode:'AI',lastMessageAt:now,createdAt:now,updatedAt:now },
  ]);
  return { service: new LeadService(leads, opps, customers, conversations, ai), leads, opps };
}

describe('BLK-080: Leads / Opportunities', () => {
  it('creates one active lead per customer and preserves tenant scope', async () => {
    const { service } = fixture();
    const first = await service.createLead(ctx('tenant-a'), { customerId:'c-a', conversationId:'conv-a' });
    const second = await service.createLead(ctx('tenant-a'), { customerId:'c-a', conversationId:'conv-a' });
    expect(second.id).toBe(first.id);
    await expect(service.createLead(ctx('tenant-b'), { customerId:'c-a' })).rejects.toMatchObject({ code:'CUSTOMER_NOT_FOUND' });
  });

  it('blocks cross-tenant lead and opportunity reads', async () => {
    const { service } = fixture();
    const lead = await service.createLead(ctx('tenant-a'), { customerId:'c-a' });
    const opportunity = await service.createOpportunity(ctx('tenant-a'), { leadId: lead.id, estimatedValueMinor: 150000 });
    await expect(service.getLead(ctx('tenant-b'), lead.id)).rejects.toMatchObject({ code:'LEAD_NOT_FOUND' });
    await expect(service.getOpportunity(ctx('tenant-b'), opportunity.id)).rejects.toMatchObject({ code:'OPPORTUNITY_NOT_FOUND' });
  });

  it('validates structured AI output before returning a lead candidate', async () => {
    const ai: AIRouterInterface = {
      resolveProvider: vi.fn(),
      execute: vi.fn(async () => ({ ok:true, data:{ provider:'fake', model:'fake-1', structuredData:{ interest:'Plano Pro', purchaseIntent:'alto', budgetMinor:50000, nextAction:'Agendar demonstração', confidence:0.91 } } })),
    };
    const { service } = fixture(ai);
    const candidate = await service.analyzeConversation(ctx('tenant-a'), 'conv-a');
    expect(candidate).toMatchObject({ interest:'Plano Pro', budgetMinor:50000, confidence:0.91 });
    expect(ai.execute).toHaveBeenCalledWith(expect.objectContaining({ tenantId:'tenant-a', capability:'LEAD_CLASSIFICATION' }));
  });

  it('rejects hallucinated/invalid monetary or confidence values from AI', () => {
    expect(() => validateLeadCandidate({ budgetMinor:-1, confidence:2 })).toThrowError(expect.objectContaining({ code:'LEAD_AI_OUTPUT_INVALID' }));
  });

  it('creates an opportunity from a validated lead without letting AI calculate commercial truth', async () => {
    const { service } = fixture();
    const lead = await service.createLead(ctx('tenant-a'), { customerId:'c-a', stage:'QUALIFICADO', candidate:{ nextAction:'Preparar proposta' } });
    const opportunity = await service.createOpportunity(ctx('tenant-a'), { leadId:lead.id, title:'Venda Plano Pro', estimatedValueMinor:99000 });
    expect(opportunity).toMatchObject({ tenantId:'tenant-a', customerId:'c-a', leadId:lead.id, stage:'QUALIFICADO', currency:'BRL', estimatedValueMinor:99000, nextAction:'Preparar proposta' });
  });

  it('validates pipeline stages and opportunity values', async () => {
    const { service } = fixture();
    const lead = await service.createLead(ctx('tenant-a'), { customerId:'c-a' });
    await expect(service.updateLead(ctx('tenant-a'), lead.id, { stage:'INVALID' as never })).rejects.toMatchObject({ code:'LEAD_STAGE_INVALID' });
    await expect(service.createOpportunity(ctx('tenant-a'), { leadId:lead.id, estimatedValueMinor:-10 })).rejects.toMatchObject({ code:'OPPORTUNITY_VALUE_INVALID' });
  });
});
