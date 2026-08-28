import { randomUUID } from 'crypto';
import { ApplicationError } from '../infrastructure/errors';
import { TenantContext } from '../types/contracts';
import { CatalogRepository } from './contracts';
import { CatalogItem, CreateCatalogItemInput, UpdateCatalogItemInput } from './model';

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

function validateName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 160) {
    throw new ApplicationError({
      category: 'VALIDATION',
      code: 'CATALOG_NAME_INVALID',
      message: 'Catalog item name is invalid.',
    });
  }
  return value;
}

function validatePrice(priceMinor: number | undefined | null): number | undefined {
  if (priceMinor === undefined || priceMinor === null) return undefined;
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) {
    throw new ApplicationError({
      category: 'VALIDATION',
      code: 'CATALOG_PRICE_INVALID',
      message: 'Catalog item price is invalid.',
    });
  }
  return priceMinor;
}

export class CatalogService {
  constructor(private readonly repository: CatalogRepository) {}

  list(context: TenantContext): Promise<CatalogItem[]> {
    return this.repository.listByTenant(requireTenant(context));
  }

  async get(context: TenantContext, id: string): Promise<CatalogItem> {
    const item = await this.repository.findById(requireTenant(context), id.trim());
    if (!item) {
      throw new ApplicationError({
        category: 'NOT_FOUND',
        code: 'CATALOG_ITEM_NOT_FOUND',
        message: 'Catalog item not found.',
      });
    }
    return item;
  }

  create(context: TenantContext, input: CreateCatalogItemInput): Promise<CatalogItem> {
    const tenantId = requireTenant(context);
    if (input.type !== 'PRODUCT' && input.type !== 'SERVICE') {
      throw new ApplicationError({
        category: 'VALIDATION',
        code: 'CATALOG_TYPE_INVALID',
        message: 'Catalog item type is invalid.',
      });
    }
    const now = new Date().toISOString();
    return this.repository.create({
      id: randomUUID(),
      tenantId,
      type: input.type,
      name: validateName(input.name),
      description: input.description?.trim() || undefined,
      active: input.active ?? true,
      priceMinor: validatePrice(input.priceMinor),
      currency: 'BRL',
      externalRef: input.externalRef?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(context: TenantContext, id: string, input: UpdateCatalogItemInput): Promise<CatalogItem> {
    const tenantId = requireTenant(context);
    const current = await this.repository.findById(tenantId, id.trim());
    if (!current) {
      throw new ApplicationError({
        category: 'NOT_FOUND',
        code: 'CATALOG_ITEM_NOT_FOUND',
        message: 'Catalog item not found.',
      });
    }

    const updated: CatalogItem = {
      ...current,
      name: input.name === undefined ? current.name : validateName(input.name),
      description: input.description === undefined ? current.description : input.description.trim() || undefined,
      active: input.active ?? current.active,
      priceMinor: input.priceMinor === undefined ? current.priceMinor : validatePrice(input.priceMinor),
      externalRef: input.externalRef === undefined ? current.externalRef : input.externalRef?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    return this.repository.update(updated);
  }
}
