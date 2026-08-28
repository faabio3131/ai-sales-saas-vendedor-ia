import { Customer, CustomerMemory, ExternalIdentity } from './model';

export interface CustomerRepository {
  listByTenant(tenantId: string): Promise<Customer[]>;
  findById(tenantId: string, id: string): Promise<Customer | null>;
  findByExternalIdentity(tenantId: string, identity: ExternalIdentity): Promise<Customer | null>;
  create(customer: Customer): Promise<Customer>;
  update(customer: Customer): Promise<Customer>;
}

export interface CustomerMemoryRepository {
  findByCustomer(tenantId: string, customerId: string): Promise<CustomerMemory | null>;
  upsert(memory: CustomerMemory): Promise<CustomerMemory>;
}
