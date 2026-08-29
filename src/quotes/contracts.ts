import { Quote, QuoteItem } from './model';

export interface QuoteRepository {
  listByTenant(tenantId: string): Promise<Quote[]>;
  findById(tenantId: string, id: string): Promise<Quote | null>;
  create(quote: Quote): Promise<Quote>;
  update(quote: Quote): Promise<Quote>;
}

export interface QuoteItemRepository {
  listByQuote(tenantId: string, quoteId: string): Promise<QuoteItem[]>;
  createMany(items: QuoteItem[]): Promise<QuoteItem[]>;
}
