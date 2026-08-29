import { describe, expect, it } from 'vitest';
import { QuoteService } from '../src/quotes/service';
import { Quote, QuoteItem } from '../src/quotes/model';
import { QuoteItemRepository, QuoteRepository } from '../src/quotes/contracts';
import { CatalogRepository } from '../src/catalog/contracts';
import { CustomerRepository } from '../src/customers/contracts';
import { OpportunityRepository } from '../src/leads/contracts';
import { TenantContext } from '../src/types/contracts';

const ctx = (tenantId: string): TenantContext => ({ tenantId, requestId: `req-${tenantId}` });

function fixture() {
  const quotes = new Map<string, Quote>();
  const items: QuoteItem[] = [];
  const quoteRepo: QuoteRepository = {
    async listByTenant(t) { return [...quotes.values()].filter(q => q.tenantId === t); },
    async findById(t, id) { const q = quotes.get(id); return q?.tenantId === t ? q : null; },
    async create(q) { quotes.set(q.id, q); return q; },
    async update(q) { quotes.set(q.id, q); return q; },
  };
  const itemRepo: QuoteItemRepository = {
    async listByQuote(t, qid) { return items.filter(i => i.tenantId === t && i.quoteId === qid); },
    async createMany(input) { items.push(...input); return input; },
  };
  const catalog: CatalogRepository = {
    async listByTenant() { return []; },
    async findById(t, id) {
      if (t !== 'tenant-a') return null;
      if (id === 'p1') return { id:'p1', tenantId:t, type:'PRODUCT', name:'Produto A', active:true, priceMinor:1500, currency:'BRL', createdAt:'x', updatedAt:'x' };
      if (id === 's1') return { id:'s1', tenantId:t, type:'SERVICE', name:'Serviço B', active:true, priceMinor:2500, currency:'BRL', createdAt:'x', updatedAt:'x' };
      return null;
    },
    async create(i) { return i; }, async update(i) { return i; },
  };
  const customers = {
    async findById(t: string, id: string) { return t === 'tenant-a' && id === 'c1' ? { id:'c1', tenantId:t } : null; },
  } as unknown as CustomerRepository;
  const opportunities = {
    async findById(t: string, id: string) { return t === 'tenant-a' && id === 'o1' ? { id:'o1', tenantId:t, customerId:'c1', stage:'QUALIFICADO', currency:'BRL' } : null; },
  } as unknown as OpportunityRepository;
  return { service: new QuoteService(quoteRepo, itemRepo, catalog, customers, opportunities), quotes };
}

describe('BLK-140 Quotes', () => {
  it('totaliza deterministicamente usando snapshot do catálogo', async () => {
    const { service } = fixture();
    const result = await service.create(ctx('tenant-a'), { customerId:'c1', items:[{catalogItemId:'p1',quantity:2},{catalogItemId:'s1',quantity:1}], discountMinor:500 });
    expect(result.quote.subtotalMinor).toBe(5500);
    expect(result.quote.discountMinor).toBe(500);
    expect(result.quote.totalMinor).toBe(5000);
    expect(result.items.map(i => i.totalMinor)).toEqual([3000,2500]);
  });

  it('rejeita quantidade e desconto inválidos', async () => {
    const { service } = fixture();
    await expect(service.create(ctx('tenant-a'), { customerId:'c1', items:[{catalogItemId:'p1',quantity:0}] })).rejects.toMatchObject({ code:'QUOTE_QUANTITY_INVALID' });
    await expect(service.create(ctx('tenant-a'), { customerId:'c1', items:[{catalogItemId:'p1',quantity:1}], discountMinor:2000 })).rejects.toMatchObject({ code:'QUOTE_DISCOUNT_INVALID' });
  });

  it('preserva isolamento entre tenants', async () => {
    const { service } = fixture();
    const created = await service.create(ctx('tenant-a'), { customerId:'c1', items:[{catalogItemId:'p1',quantity:1}] });
    await expect(service.get(ctx('tenant-b'), created.quote.id)).rejects.toMatchObject({ code:'QUOTE_NOT_FOUND' });
  });

  it('valida vínculo opportunity/customer', async () => {
    const badOpportunities = { async findById() { return { id:'o2', tenantId:'tenant-a', customerId:'other', stage:'QUALIFICADO', currency:'BRL' }; } } as unknown as OpportunityRepository;
    const base = fixture();
    const custom = new QuoteService((base as any).service['quotes'], (base as any).service['quoteItems'], (base as any).service['catalog'], (base as any).service['customers'], badOpportunities);
    await expect(custom.create(ctx('tenant-a'), { customerId:'c1', opportunityId:'o2', items:[{catalogItemId:'p1',quantity:1}] })).rejects.toMatchObject({ code:'QUOTE_OPPORTUNITY_CUSTOMER_MISMATCH' });
  });

  it('aplica state machine DRAFT -> SENT -> ACCEPTED', async () => {
    const { service } = fixture();
    const created = await service.create(ctx('tenant-a'), { customerId:'c1', opportunityId:'o1', items:[{catalogItemId:'p1',quantity:1}] });
    const sent = await service.send(ctx('tenant-a'), created.quote.id);
    expect(sent.status).toBe('SENT');
    const accepted = await service.accept(ctx('tenant-a'), created.quote.id);
    expect(accepted.status).toBe('ACCEPTED');
    await expect(service.accept(ctx('tenant-a'), created.quote.id)).rejects.toMatchObject({ code:'QUOTE_NOT_SENT' });
  });
});
