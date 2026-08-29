import { randomUUID } from 'node:crypto';
import { CatalogRepository } from '../catalog/contracts';
import { CustomerRepository } from '../customers/contracts';
import { ApplicationError } from '../infrastructure/errors';
import { OpportunityRepository } from '../leads/contracts';
import { TenantContext } from '../types/contracts';
import { QuoteItemRepository, QuoteRepository } from './contracts';
import { CreateQuoteInput, Quote, QuoteItem, QuoteWithItems } from './model';

export class QuoteService {
  constructor(
    private readonly quotes: QuoteRepository,
    private readonly quoteItems: QuoteItemRepository,
    private readonly catalog: CatalogRepository,
    private readonly customers: CustomerRepository,
    private readonly opportunities: OpportunityRepository,
  ) {}

  private tenantId(context: TenantContext): string {
    const tenantId = context.tenantId?.trim();
    if (!tenantId) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
    return tenantId;
  }

  async list(context: TenantContext): Promise<Quote[]> {
    return this.quotes.listByTenant(this.tenantId(context));
  }

  async get(context: TenantContext, quoteId: string): Promise<QuoteWithItems> {
    const tenantId = this.tenantId(context);
    const quote = await this.quotes.findById(tenantId, quoteId);
    if (!quote) throw new ApplicationError({ category: 'NOT_FOUND', code: 'QUOTE_NOT_FOUND', message: 'Quote not found.' });
    const items = await this.quoteItems.listByQuote(tenantId, quote.id);
    return { quote, items };
  }

  async create(context: TenantContext, input: CreateQuoteInput): Promise<QuoteWithItems> {
    const tenantId = this.tenantId(context);
    if (!input.customerId?.trim()) throw new ApplicationError({ category: 'VALIDATION', code: 'QUOTE_CUSTOMER_REQUIRED', message: 'Customer is required.' });
    if (!Array.isArray(input.items) || input.items.length === 0) throw new ApplicationError({ category: 'VALIDATION', code: 'QUOTE_ITEMS_REQUIRED', message: 'At least one quote item is required.' });

    const customer = await this.customers.findById(tenantId, input.customerId.trim());
    if (!customer) throw new ApplicationError({ category: 'NOT_FOUND', code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' });

    if (input.opportunityId) {
      const opportunity = await this.opportunities.findById(tenantId, input.opportunityId);
      if (!opportunity) throw new ApplicationError({ category: 'NOT_FOUND', code: 'OPPORTUNITY_NOT_FOUND', message: 'Opportunity not found.' });
      if (opportunity.customerId !== customer.id) throw new ApplicationError({ category: 'VALIDATION', code: 'QUOTE_OPPORTUNITY_CUSTOMER_MISMATCH', message: 'Opportunity does not belong to customer.' });
    }

    const quoteId = `quote_${randomUUID()}`;
    const items: QuoteItem[] = [];
    for (const inputItem of input.items) {
      if (!inputItem.catalogItemId?.trim()) throw new ApplicationError({ category: 'VALIDATION', code: 'QUOTE_CATALOG_ITEM_REQUIRED', message: 'Catalog item is required.' });
      if (!Number.isInteger(inputItem.quantity) || inputItem.quantity <= 0) throw new ApplicationError({ category: 'VALIDATION', code: 'QUOTE_QUANTITY_INVALID', message: 'Quantity must be a positive integer.' });
      const catalogItem = await this.catalog.findById(tenantId, inputItem.catalogItemId.trim());
      if (!catalogItem || !catalogItem.active) throw new ApplicationError({ category: 'NOT_FOUND', code: 'CATALOG_ITEM_NOT_AVAILABLE', message: 'Catalog item is not available.' });
      if (!Number.isInteger(catalogItem.priceMinor) || (catalogItem.priceMinor ?? -1) < 0) throw new ApplicationError({ category: 'VALIDATION', code: 'CATALOG_PRICE_REQUIRED', message: 'Catalog item must have a valid price.' });
      const unitPriceMinor = catalogItem.priceMinor as number;
      const totalMinor = unitPriceMinor * inputItem.quantity;
      items.push({
        id: `qitem_${randomUUID()}`,
        tenantId,
        quoteId,
        itemType: catalogItem.type,
        productId: catalogItem.type === 'PRODUCT' ? catalogItem.id : undefined,
        serviceId: catalogItem.type === 'SERVICE' ? catalogItem.id : undefined,
        descriptionSnapshot: catalogItem.name,
        quantity: inputItem.quantity,
        unitPriceMinor,
        totalMinor,
      });
    }

    const subtotalMinor = items.reduce((sum, item) => sum + item.totalMinor, 0);
    const discountMinor = input.discountMinor ?? 0;
    if (!Number.isInteger(discountMinor) || discountMinor < 0 || discountMinor > subtotalMinor) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'QUOTE_DISCOUNT_INVALID', message: 'Discount is invalid.' });
    }
    if (input.validUntil && Number.isNaN(Date.parse(input.validUntil))) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'QUOTE_VALID_UNTIL_INVALID', message: 'Quote validity date is invalid.' });
    }

    const now = new Date().toISOString();
    const quote: Quote = {
      id: quoteId,
      tenantId,
      customerId: customer.id,
      opportunityId: input.opportunityId,
      status: 'DRAFT',
      currency: 'BRL',
      subtotalMinor,
      discountMinor,
      totalMinor: subtotalMinor - discountMinor,
      validUntil: input.validUntil,
      createdAt: now,
      updatedAt: now,
    };

    await this.quotes.create(quote);
    await this.quoteItems.createMany(items);
    return { quote, items };
  }

  async send(context: TenantContext, quoteId: string): Promise<Quote> {
    const tenantId = this.tenantId(context);
    const quote = await this.quotes.findById(tenantId, quoteId);
    if (!quote) throw new ApplicationError({ category: 'NOT_FOUND', code: 'QUOTE_NOT_FOUND', message: 'Quote not found.' });
    if (quote.status !== 'DRAFT') throw new ApplicationError({ category: 'CONFLICT', code: 'QUOTE_NOT_DRAFT', message: 'Only draft quotes can be sent.' });
    const now = new Date().toISOString();
    return this.quotes.update({ ...quote, status: 'SENT', sentAt: now, updatedAt: now });
  }

  async accept(context: TenantContext, quoteId: string): Promise<Quote> {
    const tenantId = this.tenantId(context);
    const quote = await this.quotes.findById(tenantId, quoteId);
    if (!quote) throw new ApplicationError({ category: 'NOT_FOUND', code: 'QUOTE_NOT_FOUND', message: 'Quote not found.' });
    if (quote.status !== 'SENT') throw new ApplicationError({ category: 'CONFLICT', code: 'QUOTE_NOT_SENT', message: 'Only sent quotes can be accepted.' });
    if (quote.validUntil && quote.validUntil < new Date().toISOString()) throw new ApplicationError({ category: 'CONFLICT', code: 'QUOTE_EXPIRED', message: 'Quote has expired.' });
    const now = new Date().toISOString();
    return this.quotes.update({ ...quote, status: 'ACCEPTED', acceptedAt: now, updatedAt: now });
  }
}
