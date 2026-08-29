import { describe, expect, it } from 'vitest';
import { CatalogItem } from '../src/catalog/model';

function toFirestoreCatalogDocument(item: CatalogItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  );
}

describe('OP-020: catalog Firestore serialization', () => {
  it('removes undefined optional fields before Firestore writes', () => {
    const item: CatalogItem = {
      id: 'item-1',
      tenantId: 'tenant-a',
      type: 'PRODUCT',
      name: 'Smoke Test',
      description: undefined,
      active: true,
      priceMinor: 100,
      currency: 'BRL',
      externalRef: undefined,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-29T00:00:00.000Z',
    };

    const document = toFirestoreCatalogDocument(item);

    expect(document).not.toHaveProperty('description');
    expect(document).not.toHaveProperty('externalRef');
    expect(document).toMatchObject({
      id: 'item-1',
      tenantId: 'tenant-a',
      type: 'PRODUCT',
      name: 'Smoke Test',
      active: true,
      priceMinor: 100,
      currency: 'BRL',
    });
  });
});
