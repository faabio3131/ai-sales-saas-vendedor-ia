import { CatalogItem } from './model';

export interface CatalogRepository {
  listByTenant(tenantId: string): Promise<CatalogItem[]>;
  findById(tenantId: string, id: string): Promise<CatalogItem | null>;
  create(item: CatalogItem): Promise<CatalogItem>;
  update(item: CatalogItem): Promise<CatalogItem>;
}
