import { describe, expect, it } from 'vitest';
import { CatalogRepository } from '../src/catalog/contracts';
import { CatalogItem } from '../src/catalog/model';
import { CatalogService } from '../src/catalog/service';
import { TenantContext } from '../src/types/contracts';

class MemoryCatalogRepository implements CatalogRepository {
  private readonly items = new Map<string, CatalogItem>();

  async listByTenant(tenantId: string): Promise<CatalogItem[]> {
    return [...this.items.values()].filter((item) => item.tenantId === tenantId);
  }

  async findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    const item = this.items.get(id);
    return item?.tenantId === tenantId ? item : null;
  }

  async create(item: CatalogItem): Promise<CatalogItem> {
    this.items.set(item.id, item);
    return item;
  }

  async update(item: CatalogItem): Promise<CatalogItem> {
    this.items.set(item.id, item);
    return item;
  }
}

function context(tenantId: string): TenantContext {
  return { tenantId, userId: `user-${tenantId}`, role: 'OWNER', requestId: `req-${tenantId}` };
}

describe('BLK-040: Catalog', () => {
  it('creates products and services only inside the current tenant', async () => {
    const repository = new MemoryCatalogRepository();
    const service = new CatalogService(repository);

    const product = await service.create(context('tenant-a'), {
      type: 'PRODUCT',
      name: 'Produto A',
      priceMinor: 12990,
    });
    const serviceItem = await service.create(context('tenant-b'), {
      type: 'SERVICE',
      name: 'Serviço B',
      priceMinor: 5000,
    });

    expect(product.tenantId).toBe('tenant-a');
    expect(serviceItem.tenantId).toBe('tenant-b');
    expect(await service.list(context('tenant-a'))).toHaveLength(1);
    expect(await service.list(context('tenant-b'))).toHaveLength(1);
  });

  it('does not disclose an item that belongs to another tenant', async () => {
    const repository = new MemoryCatalogRepository();
    const service = new CatalogService(repository);
    const item = await service.create(context('tenant-a'), { type: 'PRODUCT', name: 'Privado' });

    await expect(service.get(context('tenant-b'), item.id)).rejects.toMatchObject({
      code: 'CATALOG_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('cannot update an item through another tenant context', async () => {
    const repository = new MemoryCatalogRepository();
    const service = new CatalogService(repository);
    const item = await service.create(context('tenant-a'), { type: 'SERVICE', name: 'Consultoria' });

    await expect(service.update(context('tenant-b'), item.id, { name: 'Invadido' })).rejects.toMatchObject({
      code: 'CATALOG_ITEM_NOT_FOUND',
    });
    expect((await service.get(context('tenant-a'), item.id)).name).toBe('Consultoria');
  });

  it('stores money as non-negative integer minor units', async () => {
    const service = new CatalogService(new MemoryCatalogRepository());
    await expect(service.create(context('tenant-a'), {
      type: 'PRODUCT',
      name: 'Preço inválido',
      priceMinor: 10.5,
    })).rejects.toMatchObject({ code: 'CATALOG_PRICE_INVALID' });
    await expect(service.create(context('tenant-a'), {
      type: 'PRODUCT',
      name: 'Preço negativo',
      priceMinor: -1,
    })).rejects.toMatchObject({ code: 'CATALOG_PRICE_INVALID' });
  });

  it('supports activation and safe basic updates without changing tenant ownership', async () => {
    const service = new CatalogService(new MemoryCatalogRepository());
    const created = await service.create(context('tenant-a'), {
      type: 'PRODUCT',
      name: 'Plano Inicial',
      active: true,
      priceMinor: 1000,
    });
    const updated = await service.update(context('tenant-a'), created.id, {
      name: 'Plano Atualizado',
      active: false,
      priceMinor: 1500,
    });

    expect(updated.tenantId).toBe('tenant-a');
    expect(updated.type).toBe('PRODUCT');
    expect(updated.name).toBe('Plano Atualizado');
    expect(updated.active).toBe(false);
    expect(updated.priceMinor).toBe(1500);
  });
});
