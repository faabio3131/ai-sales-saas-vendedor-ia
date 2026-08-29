export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';
export type QuoteItemType = 'PRODUCT' | 'SERVICE';

export interface Quote {
  id: string;
  tenantId: string;
  customerId: string;
  opportunityId?: string;
  status: QuoteStatus;
  currency: 'BRL';
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  validUntil?: string;
  sentAt?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteItem {
  id: string;
  tenantId: string;
  quoteId: string;
  itemType: QuoteItemType;
  productId?: string;
  serviceId?: string;
  descriptionSnapshot: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface CreateQuoteItemInput {
  catalogItemId: string;
  quantity: number;
}

export interface CreateQuoteInput {
  customerId: string;
  opportunityId?: string;
  items: CreateQuoteItemInput[];
  discountMinor?: number;
  validUntil?: string;
}

export interface QuoteWithItems {
  quote: Quote;
  items: QuoteItem[];
}
