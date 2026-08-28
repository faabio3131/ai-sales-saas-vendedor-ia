export type FollowUpStatus = 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'RETRY' | 'FAILED' | 'CANCELLED';

export interface FollowUp {
  id: string;
  tenantId: string;
  customerId: string;
  opportunityId?: string;
  conversationId?: string;
  status: FollowUpStatus;
  reason: string;
  scheduledAt: string;
  attempt: number;
  lastAttemptAt?: string;
  completedAt?: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFollowUpInput {
  customerId: string;
  opportunityId?: string;
  conversationId?: string;
  reason: string;
  scheduledAt: string;
  idempotencyKey: string;
}

export interface ExecuteFollowUpInput {
  idempotencyKey: string;
  outcome?: 'COMPLETED' | 'RETRY' | 'FAILED';
}
