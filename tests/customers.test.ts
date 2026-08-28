import { describe, expect, it } from 'vitest';
import { CustomerMemoryRepository, CustomerRepository } from '../src/customers/contracts';
import { Customer, CustomerMemory, ExternalIdentity } from '../src/customers/model';
import { CustomerService } from '../src/customers/service';
import { TenantContext } from '../src/types/contracts';

class MemoryCustomerRepository implements CustomerRepository {
  private readonly items = new Map<string, Customer>();
  listByTenant(tenantId: string): Promise<Customer[]> { return Promise.resolve([...this.items.values()].filter((item) => item.tenantId === tenantId)); }
  findById(tenantId: string, id: string): Promise<Customer | null> { const item = this.items.get(id); return Promise.resolve(item?.tenantId === tenantId ? item : null); }
  findByExternalIdentity(tenantId: string, identity: ExternalIdentity): Promise<Customer | null> {
    const source = identity.source.toLowerCase();
    const value = identity.value.toLowerCase();
    return Promise.resolve([...this.items.values()].find((item) => item.tenantId === tenantId && item.externalIdentities.some((candidate) => candidate.source.toLowerCase() === source && candidate.value.toLowerCase() === value)) ?? null);
  }
  create(customer: Customer): Promise<Customer> { this.items.set(customer.id, customer); return Promise.resolve(customer); }
  update(customer: Customer): Promise<Customer> { this.items.set(customer.id, customer); return Promise.resolve(customer); }
}

class MemoryCustomerMemoryRepository implements CustomerMemoryRepository {
  private readonly memories = new Map<string, CustomerMemory>();
  findByCustomer(tenantId: string, customerId: string): Promise<CustomerMemory | null> { return Promise.resolve(this.memories.get(`${tenantId}:${customerId}`) ?? null); }
  upsert(memory: CustomerMemory): Promise<CustomerMemory> { this.memories.set(`${memory.tenantId}:${memory.customerId}`, memory); return Promise.resolve(memory); }
}

function context(tenantId: string): TenantContext {
  return { tenantId, userId: `user-${tenantId}`, role: 'OWNER', requestId: `req-${tenantId}` };
}

function service() { return new CustomerService(new MemoryCustomerRepository(), new MemoryCustomerMemoryRepository()); }

describe('BLK-050: Customers', () => {
  it('creates and lists customers only inside the current tenant', async () => {
    const customers = service();
    await customers.create(context('tenant-a'), { name: 'Ana', phone: '+5511999999999' });
    await customers.create(context('tenant-b'), { name: 'Bruno', email: 'BRUNO@example.com' });
    expect(await customers.list(context('tenant-a'))).toHaveLength(1);
    expect((await customers.list(context('tenant-b')))[0].email).toBe('bruno@example.com');
  });

  it('does not disclose or update a customer from another tenant', async () => {
    const customers = service();
    const created = await customers.create(context('tenant-a'), { name: 'Privado' });
    await expect(customers.get(context('tenant-b'), created.id)).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND', statusCode: 404 });
    await expect(customers.update(context('tenant-b'), created.id, { name: 'Invadido' })).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('prevents duplicate external identity within the same tenant but not across tenants', async () => {
    const customers = service();
    const identity = [{ source: 'whatsapp', value: '5511999999999' }];
    await customers.create(context('tenant-a'), { name: 'A', externalIdentities: identity });
    await expect(customers.create(context('tenant-a'), { name: 'B', externalIdentities: identity })).rejects.toMatchObject({ code: 'CUSTOMER_IDENTITY_ALREADY_EXISTS' });
    await expect(customers.create(context('tenant-b'), { name: 'C', externalIdentities: identity })).resolves.toMatchObject({ tenantId: 'tenant-b' });
  });

  it('keeps CustomerMemory separate from the customer record and tenant-scoped', async () => {
    const customers = service();
    const created = await customers.create(context('tenant-a'), { name: 'Cliente' });
    const memory = await customers.updateMemory(context('tenant-a'), created.id, {
      summary: 'Interested in commercial automation.',
      interests: ['WhatsApp', 'WhatsApp', 'CRM'],
      productIds: ['prod-1'],
      objections: ['price'],
      lastContactAt: '2026-08-28T18:00:00-03:00',
    });
    expect(memory.customerId).toBe(created.id);
    expect(memory.interests).toEqual(['WhatsApp', 'CRM']);
    expect(memory.lastContactAt).toBe('2026-08-28T21:00:00.000Z');
    expect((await customers.get(context('tenant-a'), created.id)).tenantId).toBe('tenant-a');
    await expect(customers.getMemory(context('tenant-b'), created.id)).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('validates minimized contact data and memory limits', async () => {
    const customers = service();
    await expect(customers.create(context('tenant-a'), { name: 'A', phone: 'abc' })).rejects.toMatchObject({ code: 'CUSTOMER_PHONE_INVALID' });
    await expect(customers.create(context('tenant-a'), { name: 'A', email: 'invalid' })).rejects.toMatchObject({ code: 'CUSTOMER_EMAIL_INVALID' });
    const created = await customers.create(context('tenant-a'), { name: 'A' });
    await expect(customers.updateMemory(context('tenant-a'), created.id, { summary: 'x'.repeat(4001) })).rejects.toMatchObject({ code: 'CUSTOMER_MEMORY_SUMMARY_INVALID' });
  });
});
