import { FollowUp } from './model';

export interface FollowUpRepository {
  listByTenant(tenantId: string): Promise<FollowUp[]>;
  findById(tenantId: string, id: string): Promise<FollowUp | null>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FollowUp | null>;
  listDue(tenantId: string, dueBefore: string): Promise<FollowUp[]>;
  create(followUp: FollowUp): Promise<FollowUp>;
  update(followUp: FollowUp): Promise<FollowUp>;
}
