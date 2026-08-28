import { randomUUID } from 'crypto';
import { ApplicationError } from '../infrastructure/errors';
import { TenantContext } from '../types/contracts';
import { CustomerMemoryRepository, CustomerRepository } from './contracts';
import {
  CreateCustomerInput,
  Customer,
  CustomerMemory,
  ExternalIdentity,
  UpdateCustomerInput,
  UpdateCustomerMemoryInput,
} from './model';

function requireTenant(context: TenantContext): string {
  const tenantId = context.tenantId?.trim();
  if (!tenantId) {
    throw new ApplicationError({
      category: 'FORBIDDEN',
      code: 'TENANT_CONTEXT_REQUIRED',
      message: 'Tenant context is required.',
    });
  }
  return tenantId;
}

function requireName(name: string): string {
  const value = name?.trim();
  if (!value || value.length > 160) {
    throw new ApplicationError({
      category: 'VALIDATION',
      code: 'CUSTOMER_NAME_INVALID',
      message: 'Customer name is invalid.',
    });
  }
  return value;
}

function normalizeEmail(value?: string | null): string | undefined {
  if (value === undefined || value === null || value.trim() === '') return undefined;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_EMAIL_INVALID', message: 'Customer email is invalid.' });
  }
  return email;
}

function normalizePhone(value?: string | null): string | undefined {
  if (value === undefined || value === null || value.trim() === '') return undefined;
  const phone = value.trim().replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{8,15}$/.test(phone)) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_PHONE_INVALID', message: 'Customer phone is invalid.' });
  }
  return phone;
}

function normalizeIdentities(input: ExternalIdentity[] | undefined): ExternalIdentity[] {
  if (!input) return [];
  if (!Array.isArray(input) || input.length > 20) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_IDENTITIES_INVALID', message: 'Customer identities are invalid.' });
  }
  const seen = new Set<string>();
  return input.map((identity) => {
    const source = identity?.source?.trim().toLowerCase();
    const value = identity?.value?.trim();
    if (!source || !value || source.length > 60 || value.length > 300) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_IDENTITIES_INVALID', message: 'Customer identities are invalid.' });
    }
    const key = `${source}:${value.toLowerCase()}`;
    if (seen.has(key)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_IDENTITY_DUPLICATED', message: 'Customer identity is duplicated.' });
    }
    seen.add(key);
    return { source, value };
  });
}

function normalizeStringList(value: string[] | undefined, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_MEMORY_INVALID', message: `Customer memory ${field} is invalid.` });
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 100);
}

function normalizeTimestamp(value?: string | null): string | undefined {
  if (value === undefined || value === null || value.trim() === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_MEMORY_TIMESTAMP_INVALID', message: 'Customer memory timestamp is invalid.' });
  }
  return date.toISOString();
}

export class CustomerService {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly memories: CustomerMemoryRepository,
  ) {}

  list(context: TenantContext): Promise<Customer[]> {
    return this.customers.listByTenant(requireTenant(context));
  }

  async get(context: TenantContext, id: string): Promise<Customer> {
    const customer = await this.customers.findById(requireTenant(context), id.trim());
    if (!customer) throw new ApplicationError({ category: 'NOT_FOUND', code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' });
    return customer;
  }

  async create(context: TenantContext, input: CreateCustomerInput): Promise<Customer> {
    const tenantId = requireTenant(context);
    const identities = normalizeIdentities(input.externalIdentities);
    for (const identity of identities) {
      if (await this.customers.findByExternalIdentity(tenantId, identity)) {
        throw new ApplicationError({ category: 'CONFLICT', code: 'CUSTOMER_IDENTITY_ALREADY_EXISTS', message: 'Customer identity already exists.' });
      }
    }
    if (input.status !== undefined && input.status !== 'ACTIVE' && input.status !== 'INACTIVE') {
      throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_STATUS_INVALID', message: 'Customer status is invalid.' });
    }
    const now = new Date().toISOString();
    const customer: Customer = {
      id: randomUUID(), tenantId, name: requireName(input.name),
      phone: normalizePhone(input.phone), email: normalizeEmail(input.email),
      externalIdentities: identities, status: input.status ?? 'ACTIVE', createdAt: now, updatedAt: now,
    };
    return this.customers.create(customer);
  }

  async update(context: TenantContext, id: string, input: UpdateCustomerInput): Promise<Customer> {
    const tenantId = requireTenant(context);
    const current = await this.get(context, id);
    const identities = input.externalIdentities === undefined ? current.externalIdentities : normalizeIdentities(input.externalIdentities);
    for (const identity of identities) {
      const existing = await this.customers.findByExternalIdentity(tenantId, identity);
      if (existing && existing.id !== current.id) {
        throw new ApplicationError({ category: 'CONFLICT', code: 'CUSTOMER_IDENTITY_ALREADY_EXISTS', message: 'Customer identity already exists.' });
      }
    }
    if (input.status !== undefined && input.status !== 'ACTIVE' && input.status !== 'INACTIVE') {
      throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_STATUS_INVALID', message: 'Customer status is invalid.' });
    }
    return this.customers.update({
      ...current,
      name: input.name === undefined ? current.name : requireName(input.name),
      phone: input.phone === undefined ? current.phone : normalizePhone(input.phone),
      email: input.email === undefined ? current.email : normalizeEmail(input.email),
      externalIdentities: identities,
      status: input.status ?? current.status,
      updatedAt: new Date().toISOString(),
    });
  }

  async getMemory(context: TenantContext, customerId: string): Promise<CustomerMemory> {
    const tenantId = requireTenant(context);
    await this.get(context, customerId);
    const existing = await this.memories.findByCustomer(tenantId, customerId.trim());
    return existing ?? {
      id: randomUUID(), tenantId, customerId: customerId.trim(), summary: '', interests: [], productIds: [], serviceIds: [], objections: [], preferences: [], updatedAt: new Date().toISOString(),
    };
  }

  async updateMemory(context: TenantContext, customerId: string, input: UpdateCustomerMemoryInput): Promise<CustomerMemory> {
    const tenantId = requireTenant(context);
    await this.get(context, customerId);
    const current = await this.getMemory(context, customerId);
    const summary = input.summary === undefined ? current.summary : input.summary.trim();
    if (summary.length > 4000) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'CUSTOMER_MEMORY_SUMMARY_INVALID', message: 'Customer memory summary is invalid.' });
    }
    const memory: CustomerMemory = {
      ...current,
      tenantId,
      customerId: customerId.trim(),
      summary,
      interests: normalizeStringList(input.interests, 'interests') ?? current.interests,
      productIds: normalizeStringList(input.productIds, 'productIds') ?? current.productIds,
      serviceIds: normalizeStringList(input.serviceIds, 'serviceIds') ?? current.serviceIds,
      objections: normalizeStringList(input.objections, 'objections') ?? current.objections,
      preferences: normalizeStringList(input.preferences, 'preferences') ?? current.preferences,
      lastContactAt: input.lastContactAt === undefined ? current.lastContactAt : normalizeTimestamp(input.lastContactAt),
      lastFollowUpAt: input.lastFollowUpAt === undefined ? current.lastFollowUpAt : normalizeTimestamp(input.lastFollowUpAt),
      updatedAt: new Date().toISOString(),
    };
    return this.memories.upsert(memory);
  }
}
