import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../infrastructure/errors';
import { TenantContext } from '../types/contracts';
import { FollowUpRepository } from './contracts';
import { CreateFollowUpInput, ExecuteFollowUpInput, FollowUp, FollowUpStatus } from './model';

function requireTenant(context: TenantContext): string {
  const tenantId = context.tenantId?.trim();
  if (!tenantId) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return tenantId;
}

function requireText(value: string | undefined, code: string, message: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new ApplicationError({ category: 'VALIDATION', code, message });
  return normalized;
}

function requireIsoTimestamp(value: string | undefined, code: string): string {
  const normalized = requireText(value, code, 'A valid timestamp is required.');
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) throw new ApplicationError({ category: 'VALIDATION', code, message: 'A valid timestamp is required.' });
  return new Date(parsed).toISOString();
}

export class FollowUpService {
  constructor(private readonly repository: FollowUpRepository) {}

  async list(context: TenantContext): Promise<FollowUp[]> {
    return this.repository.listByTenant(requireTenant(context));
  }

  async get(context: TenantContext, id: string): Promise<FollowUp> {
    const tenantId = requireTenant(context);
    const item = await this.repository.findById(tenantId, requireText(id, 'FOLLOWUP_ID_REQUIRED', 'Follow-up id is required.'));
    if (!item) throw new ApplicationError({ category: 'NOT_FOUND', code: 'FOLLOWUP_NOT_FOUND', message: 'Follow-up not found.' });
    return item;
  }

  async listDue(context: TenantContext, dueBefore?: string): Promise<FollowUp[]> {
    const tenantId = requireTenant(context);
    const boundary = dueBefore ? requireIsoTimestamp(dueBefore, 'DUE_BEFORE_INVALID') : new Date().toISOString();
    return this.repository.listDue(tenantId, boundary);
  }

  async create(context: TenantContext, input: CreateFollowUpInput): Promise<FollowUp> {
    const tenantId = requireTenant(context);
    const customerId = requireText(input.customerId, 'CUSTOMER_ID_REQUIRED', 'Customer id is required.');
    const reason = requireText(input.reason, 'FOLLOWUP_REASON_REQUIRED', 'Follow-up reason is required.');
    const scheduledAt = requireIsoTimestamp(input.scheduledAt, 'FOLLOWUP_SCHEDULE_INVALID');
    const idempotencyKey = requireText(input.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency key is required.');

    const existing = await this.repository.findByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) return existing;

    const now = new Date().toISOString();
    return this.repository.create({
      id: randomUUID(), tenantId, customerId,
      opportunityId: input.opportunityId?.trim() || undefined,
      conversationId: input.conversationId?.trim() || undefined,
      status: 'SCHEDULED', reason, scheduledAt, attempt: 0,
      idempotencyKey, createdAt: now, updatedAt: now,
    });
  }

  async execute(context: TenantContext, id: string, input: ExecuteFollowUpInput): Promise<FollowUp> {
    const tenantId = requireTenant(context);
    const followUp = await this.repository.findById(tenantId, requireText(id, 'FOLLOWUP_ID_REQUIRED', 'Follow-up id is required.'));
    if (!followUp) throw new ApplicationError({ category: 'NOT_FOUND', code: 'FOLLOWUP_NOT_FOUND', message: 'Follow-up not found.' });

    const executionKey = requireText(input.idempotencyKey, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency key is required.');
    if (executionKey !== followUp.idempotencyKey) {
      throw new ApplicationError({ category: 'CONFLICT', code: 'IDEMPOTENCY_KEY_MISMATCH', message: 'Idempotency key does not match this follow-up.' });
    }
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(followUp.status)) return followUp;
    if (followUp.status === 'PROCESSING') return followUp;

    const now = new Date().toISOString();
    const outcome: Exclude<FollowUpStatus, 'SCHEDULED' | 'PROCESSING' | 'CANCELLED'> = input.outcome ?? 'COMPLETED';
    return this.repository.update({
      ...followUp,
      status: outcome,
      attempt: followUp.attempt + 1,
      lastAttemptAt: now,
      completedAt: outcome === 'COMPLETED' ? now : undefined,
      updatedAt: now,
    });
  }

  async cancel(context: TenantContext, id: string): Promise<FollowUp> {
    const item = await this.get(context, id);
    if (item.status === 'COMPLETED' || item.status === 'FAILED') return item;
    const updatedAt = new Date().toISOString();
    return this.repository.update({ ...item, status: 'CANCELLED', updatedAt });
  }
}
