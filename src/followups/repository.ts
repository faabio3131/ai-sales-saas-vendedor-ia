import { FollowUpRepository } from './contracts';
import { FollowUp } from './model';

export class InMemoryFollowUpRepository implements FollowUpRepository {
  private readonly items = new Map<string, FollowUp>();

  constructor(seed: FollowUp[] = []) {
    for (const item of seed) this.items.set(item.id, structuredClone(item));
  }

  async listByTenant(tenantId: string): Promise<FollowUp[]> {
    return [...this.items.values()]
      .filter((item) => item.tenantId === tenantId)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .map((item) => structuredClone(item));
  }

  async findById(tenantId: string, id: string): Promise<FollowUp | null> {
    const item = this.items.get(id);
    return item?.tenantId === tenantId ? structuredClone(item) : null;
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FollowUp | null> {
    const found = [...this.items.values()].find((item) => item.tenantId === tenantId && item.idempotencyKey === idempotencyKey);
    return found ? structuredClone(found) : null;
  }

  async listDue(tenantId: string, dueBefore: string): Promise<FollowUp[]> {
    return [...this.items.values()]
      .filter((item) => item.tenantId === tenantId && ['SCHEDULED', 'RETRY'].includes(item.status) && item.scheduledAt <= dueBefore)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
      .map((item) => structuredClone(item));
  }

  async create(followUp: FollowUp): Promise<FollowUp> {
    this.items.set(followUp.id, structuredClone(followUp));
    return structuredClone(followUp);
  }

  async update(followUp: FollowUp): Promise<FollowUp> {
    this.items.set(followUp.id, structuredClone(followUp));
    return structuredClone(followUp);
  }
}
