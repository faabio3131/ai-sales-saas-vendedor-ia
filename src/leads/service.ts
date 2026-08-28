import { randomUUID } from 'crypto';
import { AIRouterInterface } from '../ai/contracts';
import { ConversationRepository } from '../conversations/contracts';
import { CustomerRepository } from '../customers/contracts';
import { ApplicationError } from '../infrastructure/errors';
import { TenantContext } from '../types/contracts';
import { LeadRepository, OpportunityRepository } from './contracts';
import { FUNNEL_STAGES, FunnelStage, Lead, LeadCandidate, Opportunity } from './model';

function tenantId(context: TenantContext): string {
  const id = context.tenantId?.trim();
  if (!id) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return id;
}

function validStage(value: unknown): value is FunnelStage {
  return typeof value === 'string' && (FUNNEL_STAGES as readonly string[]).includes(value);
}

function optionalString(value: unknown, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_AI_OUTPUT_INVALID', message: 'Lead intelligence output is invalid.' });
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_AI_OUTPUT_INVALID', message: 'Lead intelligence output is invalid.' });
  return normalized;
}

export function validateLeadCandidate(value: unknown): LeadCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_AI_OUTPUT_INVALID', message: 'Lead intelligence output is invalid.' });
  }
  const raw = value as Record<string, unknown>;
  const confidence = raw.confidence === undefined ? undefined : Number(raw.confidence);
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_AI_OUTPUT_INVALID', message: 'Lead intelligence output is invalid.' });
  }
  const budgetMinor = raw.budgetMinor === undefined ? undefined : Number(raw.budgetMinor);
  if (budgetMinor !== undefined && (!Number.isInteger(budgetMinor) || budgetMinor < 0)) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_AI_OUTPUT_INVALID', message: 'Lead intelligence output is invalid.' });
  }
  return {
    interest: optionalString(raw.interest),
    purchaseIntent: optionalString(raw.purchaseIntent, 100),
    urgency: optionalString(raw.urgency, 100),
    budgetMinor,
    objection: optionalString(raw.objection),
    sentiment: optionalString(raw.sentiment, 100),
    nextAction: optionalString(raw.nextAction),
    confidence,
  };
}

export class LeadService {
  constructor(
    private readonly leads: LeadRepository,
    private readonly opportunities: OpportunityRepository,
    private readonly customers: CustomerRepository,
    private readonly conversations: ConversationRepository,
    private readonly ai?: AIRouterInterface,
  ) {}

  listLeads(context: TenantContext): Promise<Lead[]> {
    return this.leads.listByTenant(tenantId(context));
  }

  listOpportunities(context: TenantContext): Promise<Opportunity[]> {
    return this.opportunities.listByTenant(tenantId(context));
  }

  async getLead(context: TenantContext, id: string): Promise<Lead> {
    const lead = await this.leads.findById(tenantId(context), id.trim());
    if (!lead) throw new ApplicationError({ category: 'NOT_FOUND', code: 'LEAD_NOT_FOUND', message: 'Lead not found.' });
    return lead;
  }

  async getOpportunity(context: TenantContext, id: string): Promise<Opportunity> {
    const opportunity = await this.opportunities.findById(tenantId(context), id.trim());
    if (!opportunity) throw new ApplicationError({ category: 'NOT_FOUND', code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
    return opportunity;
  }

  async createLead(context: TenantContext, input: { customerId: string; conversationId?: string; stage?: FunnelStage; candidate?: LeadCandidate }): Promise<Lead> {
    const tenant = tenantId(context);
    const customerId = input.customerId?.trim();
    if (!customerId || !(await this.customers.findById(tenant, customerId))) {
      throw new ApplicationError({ category: 'NOT_FOUND', code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' });
    }
    const conversationId = input.conversationId?.trim() || undefined;
    if (conversationId) {
      const conversation = await this.conversations.findById(tenant, conversationId);
      if (!conversation || conversation.customerId !== customerId) {
        throw new ApplicationError({ category: 'NOT_FOUND', code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
      }
    }
    const existing = await this.leads.findActiveByCustomer(tenant, customerId);
    if (existing) return existing;
    const stage = input.stage ?? 'NOVO';
    if (!validStage(stage)) throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_STAGE_INVALID', message: 'Lead stage is invalid.' });
    const now = new Date().toISOString();
    return this.leads.create({ id: randomUUID(), tenantId: tenant, customerId, conversationId, stage, ...input.candidate, createdAt: now, updatedAt: now });
  }

  async updateLead(context: TenantContext, id: string, input: Partial<Omit<Lead, 'id'|'tenantId'|'customerId'|'conversationId'|'createdAt'|'updatedAt'>>): Promise<Lead> {
    const current = await this.getLead(context, id);
    if (input.stage !== undefined && !validStage(input.stage)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'LEAD_STAGE_INVALID', message: 'Lead stage is invalid.' });
    }
    const candidate = validateLeadCandidate({
      interest: input.interest,
      purchaseIntent: input.purchaseIntent,
      urgency: input.urgency,
      budgetMinor: input.budgetMinor,
      objection: input.objection,
      sentiment: input.sentiment,
      nextAction: input.nextAction,
      confidence: input.confidence,
    });
    return this.leads.update({ ...current, ...candidate, ...(input.stage ? { stage: input.stage } : {}), updatedAt: new Date().toISOString() });
  }

  async analyzeConversation(context: TenantContext, conversationId: string): Promise<LeadCandidate> {
    const tenant = tenantId(context);
    const conversation = await this.conversations.findById(tenant, conversationId.trim());
    if (!conversation) throw new ApplicationError({ category: 'NOT_FOUND', code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    if (!this.ai) throw new ApplicationError({ category: 'PROVIDER', code: 'AI_ROUTER_UNAVAILABLE', message: 'AI service is unavailable.', retryable: true });
    const result = await this.ai.execute({
      tenantId: tenant,
      capability: 'LEAD_CLASSIFICATION',
      systemInstructions: 'Extract only supported commercial lead signals. Never invent price, product, budget or permission.',
      input: { conversationId: conversation.id, customerId: conversation.customerId },
      responseSchema: { interest: 'string?', purchaseIntent: 'string?', urgency: 'string?', budgetMinor: 'integer?', objection: 'string?', sentiment: 'string?', nextAction: 'string?', confidence: 'number 0..1?' },
      metadata: { source: 'BLK-080_LEAD_INTELLIGENCE' },
    });
    if (!result.ok || !result.data) {
      throw new ApplicationError({ category: 'PROVIDER', code: result.error?.code || 'LEAD_AI_FAILED', message: 'Lead intelligence failed.', retryable: result.error?.retryable ?? true });
    }
    return validateLeadCandidate(result.data.structuredData);
  }

  async createOpportunity(context: TenantContext, input: { leadId: string; title?: string; estimatedValueMinor?: number; nextAction?: string; nextActionAt?: string }): Promise<Opportunity> {
    const lead = await this.getLead(context, input.leadId);
    if (input.estimatedValueMinor !== undefined && (!Number.isInteger(input.estimatedValueMinor) || input.estimatedValueMinor < 0)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'OPPORTUNITY_VALUE_INVALID', message: 'Opportunity value is invalid.' });
    }
    const nextActionAt = input.nextActionAt ? new Date(input.nextActionAt) : undefined;
    if (nextActionAt && Number.isNaN(nextActionAt.getTime())) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'OPPORTUNITY_NEXT_ACTION_AT_INVALID', message: 'Opportunity next action timestamp is invalid.' });
    }
    const now = new Date().toISOString();
    return this.opportunities.create({
      id: randomUUID(), tenantId: lead.tenantId, customerId: lead.customerId, leadId: lead.id,
      stage: lead.stage, title: input.title?.trim() || undefined, estimatedValueMinor: input.estimatedValueMinor,
      currency: 'BRL', nextAction: input.nextAction?.trim() || lead.nextAction,
      nextActionAt: nextActionAt?.toISOString(), createdAt: now, updatedAt: now,
    });
  }

  async updateOpportunity(context: TenantContext, id: string, input: { stage?: FunnelStage; title?: string; estimatedValueMinor?: number; nextAction?: string; nextActionAt?: string; lostReason?: string }): Promise<Opportunity> {
    const current = await this.getOpportunity(context, id);
    if (input.stage !== undefined && !validStage(input.stage)) throw new ApplicationError({ category: 'VALIDATION', code: 'OPPORTUNITY_STAGE_INVALID', message: 'Opportunity stage is invalid.' });
    if (input.estimatedValueMinor !== undefined && (!Number.isInteger(input.estimatedValueMinor) || input.estimatedValueMinor < 0)) throw new ApplicationError({ category: 'VALIDATION', code: 'OPPORTUNITY_VALUE_INVALID', message: 'Opportunity value is invalid.' });
    let nextActionAt = current.nextActionAt;
    if (input.nextActionAt !== undefined) {
      const parsed = new Date(input.nextActionAt);
      if (Number.isNaN(parsed.getTime())) throw new ApplicationError({ category: 'VALIDATION', code: 'OPPORTUNITY_NEXT_ACTION_AT_INVALID', message: 'Opportunity next action timestamp is invalid.' });
      nextActionAt = parsed.toISOString();
    }
    return this.opportunities.update({ ...current, ...input, nextActionAt, title: input.title?.trim() || current.title, nextAction: input.nextAction?.trim() || current.nextAction, lostReason: input.lostReason?.trim() || current.lostReason, updatedAt: new Date().toISOString() });
  }
}
