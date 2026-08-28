import { describe, expect, it } from 'vitest';
import { InMemoryFollowUpRepository } from '../src/followups/repository';
import { FollowUpService } from '../src/followups/service';
import { TenantContext } from '../src/types/contracts';

const ctx = (tenantId: string): TenantContext => ({ tenantId, requestId: `req-${tenantId}` });

describe('BLK-100: Follow-up', () => {
  it('creates and lists follow-ups only inside the active tenant', async () => {
    const repo = new InMemoryFollowUpRepository();
    const service = new FollowUpService(repo);
    await service.create(ctx('tenant-a'), { customerId: 'customer-a', reason: 'Retomar proposta', scheduledAt: '2026-08-29T12:00:00Z', idempotencyKey: 'fu-a' });
    await service.create(ctx('tenant-b'), { customerId: 'customer-b', reason: 'Outro tenant', scheduledAt: '2026-08-29T12:00:00Z', idempotencyKey: 'fu-b' });
    const list = await service.list(ctx('tenant-a'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tenantId: 'tenant-a', customerId: 'customer-a', status: 'SCHEDULED', attempt: 0 });
  });

  it('returns only due scheduled/retry follow-ups at the requested boundary', async () => {
    const service = new FollowUpService(new InMemoryFollowUpRepository());
    await service.create(ctx('tenant-a'), { customerId: 'c1', reason: 'Due', scheduledAt: '2026-08-28T10:00:00Z', idempotencyKey: 'due-1' });
    await service.create(ctx('tenant-a'), { customerId: 'c2', reason: 'Future', scheduledAt: '2026-08-30T10:00:00Z', idempotencyKey: 'due-2' });
    const due = await service.listDue(ctx('tenant-a'), '2026-08-29T00:00:00Z');
    expect(due.map((item) => item.customerId)).toEqual(['c1']);
  });

  it('deduplicates creation by tenant-scoped idempotency key', async () => {
    const service = new FollowUpService(new InMemoryFollowUpRepository());
    const first = await service.create(ctx('tenant-a'), { customerId: 'c1', reason: 'A', scheduledAt: '2026-08-29T10:00:00Z', idempotencyKey: 'same-key' });
    const second = await service.create(ctx('tenant-a'), { customerId: 'c1', reason: 'B', scheduledAt: '2026-08-30T10:00:00Z', idempotencyKey: 'same-key' });
    expect(second.id).toBe(first.id);
    expect((await service.list(ctx('tenant-a')))).toHaveLength(1);
  });

  it('executes once and repeated completion does not increment attempt', async () => {
    const service = new FollowUpService(new InMemoryFollowUpRepository());
    const created = await service.create(ctx('tenant-a'), { customerId: 'c1', reason: 'Contato', scheduledAt: '2026-08-28T10:00:00Z', idempotencyKey: 'exec-1' });
    const first = await service.execute(ctx('tenant-a'), created.id, { idempotencyKey: 'exec-1', outcome: 'COMPLETED' });
    const second = await service.execute(ctx('tenant-a'), created.id, { idempotencyKey: 'exec-1', outcome: 'COMPLETED' });
    expect(first.status).toBe('COMPLETED');
    expect(first.attempt).toBe(1);
    expect(first.completedAt).toBeTruthy();
    expect(second.attempt).toBe(1);
  });

  it('supports retry outcome and exposes it again as due', async () => {
    const service = new FollowUpService(new InMemoryFollowUpRepository());
    const created = await service.create(ctx('tenant-a'), { customerId: 'c1', reason: 'Retry', scheduledAt: '2026-08-28T10:00:00Z', idempotencyKey: 'retry-1' });
    const retried = await service.execute(ctx('tenant-a'), created.id, { idempotencyKey: 'retry-1', outcome: 'RETRY' });
    expect(retried).toMatchObject({ status: 'RETRY', attempt: 1 });
    expect(await service.listDue(ctx('tenant-a'), '2026-08-29T00:00:00Z')).toHaveLength(1);
  });

  it('blocks cross-tenant lookup and idempotency mismatch', async () => {
    const service = new FollowUpService(new InMemoryFollowUpRepository());
    const created = await service.create(ctx('tenant-a'), { customerId: 'c1', reason: 'Protected', scheduledAt: '2026-08-28T10:00:00Z', idempotencyKey: 'protected-key' });
    await expect(service.get(ctx('tenant-b'), created.id)).rejects.toMatchObject({ code: 'FOLLOWUP_NOT_FOUND' });
    await expect(service.execute(ctx('tenant-a'), created.id, { idempotencyKey: 'wrong-key' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_MISMATCH' });
  });
});
