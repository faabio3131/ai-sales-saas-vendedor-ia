export type CatalogItemType = 'PRODUCT' | 'SERVICE';

export interface CatalogItem {
  id: string;
  tenantId: string;
  type: CatalogItemType;
  name: string;
  description?: string;
  active: boolean;
  priceMinor?: number;
  currency: 'BRL';
  externalRef?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCatalogItemInput {
  type: CatalogItemType;
  name: string;
  description?: string;
  active?: boolean;
  priceMinor?: number;
  externalRef?: string;
}

export interface UpdateCatalogItemInput {
  name?: string;
  description?: string;
  active?: boolean;
  priceMinor?: number | null;
  externalRef?: string | null;
}
