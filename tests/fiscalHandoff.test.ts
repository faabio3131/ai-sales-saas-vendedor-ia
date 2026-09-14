import { describe, expect, it } from 'vitest';
import { SalesFiscalHandoffRepository } from '../src/fiscal/contracts';
import { SalesFiscalHandoff } from '../src/fiscal/model';
import { SalesFiscalHandoffService } from '../src/fiscal/service';
import { Payment } from '../src/payments/model';
import { QuoteItemRepository, QuoteRepository } from '../src/quotes/contracts';
import { Quote, QuoteItem } from '../src/quotes/model';

class HandoffRepo implements SalesFiscalHandoffRepository {
  records: SalesFiscalHandoff[] = [];
  async findByIdempotencyKey(tenantId: string, idempotencyKey: string) {
    return this.records.find((record) => record.tenantId === tenantId && record.idempotencyKey === idempotencyKey) ?? null;
  }
  async create(handoff: SalesFiscalHandoff) {
    this.records.push(handoff);
    return handoff;
  }
}

class QuoteRepo implements QuoteRepository {
  constructor(private readonly quote: Quote) {}
  async listByTenant(tenantId: string) { return this.quote.tenantId === tenantId ? [this.quote] : []; }
  async findById(tenantId: string, id: string) { return this.quote.tenantId === tenantId && this.quote.id === id ? this.quote : null; }
  async create(quote: Quote) { return quote; }
  async update(quote: Quote) { return quote; }
}

class ItemRepo implements QuoteItemRepository {
  constructor(private readonly items: QuoteItem[]) {}
  async listByQuote(tenantId: string, quoteId: string) {
    return this.items.filter((item) => item.tenantId === tenantId && item.quoteId === quoteId);
  }
  async createMany(items: QuoteItem[]) { return items; }
}

function quote(): Quote {
  return {
    id: 'quote-1', tenantId: 'tenant-a', customerId: 'customer-1', status: 'ACCEPTED', currency: 'BRL',
    subtotalMinor: 10000, discountMinor: 1000, totalMinor: 9000,
    acceptedAt: '2026-09-13T10:00:00.000Z', createdAt: '2026-09-13T09:00:00.000Z', updatedAt: '2026-09-13T10:00:00.000Z',
  };
}

function payment(): Payment {
  return {
    id: 'payment-1', tenantId: 'tenant-a', customerId: 'customer-1', quoteId: 'quote-1', provider: 'FAKEPAY',
    providerPaymentId: 'provider-1', method: 'PIX', status: 'CONFIRMED', amountMinor: 9000, currency: 'BRL',
    idempotencyKey: 'payment-request-1', confirmedAt: '2026-09-13T10:05:00.000Z',
    createdAt: '2026-09-13T10:01:00.000Z', updatedAt: '2026-09-13T10:05:00.000Z',
  };
}

function item(itemType: 'PRODUCT' | 'SERVICE' = 'PRODUCT'): QuoteItem {
  return {
    id: 'item-1', tenantId: 'tenant-a', quoteId: 'quote-1', itemType,
    productId: itemType === 'PRODUCT' ? 'product-1' : undefined,
    serviceId: itemType === 'SERVICE' ? 'service-1' : undefined,
    descriptionSnapshot: itemType === 'PRODUCT' ? 'Produto A' : 'Servico A',
    quantity: 1, unitPriceMinor: 9000, totalMinor: 9000,
  };
}

describe('V2-16.4 Vendedor IA fiscal handoff', () => {
  it('persiste fato liquidado idempotente sem inventar NFC-e ou NF-e', async () => {
    const handoffs = new HandoffRepo();
    const service = new SalesFiscalHandoffService(handoffs, new QuoteRepo(quote()), new ItemRepo([item()]));

    await service.onConfirmed(payment());
    await service.onConfirmed(payment());

    expect(handoffs.records).toHaveLength(1);
    const handoff = handoffs.records[0];
    expect(handoff.hostNamespace).toBe('fm.vendedor-ia');
    expect(handoff.packId).toBe('sales');
    expect(handoff.operationKind).toBe('sale');
    expect(handoff.allowedUseCaseIds).toEqual(['nfce-sale', 'nfe-sale']);
    expect(handoff.allowedDocumentKinds).toEqual(['nfce', 'nfe']);
    expect(handoff.state).toBe('PENDING_FISCAL_CLASSIFICATION');
    expect(handoff.documentSelectionRequired).toBe(true);
    expect(handoff.fiscalRecipientDataRequired).toBe(true);
    expect(handoff.fiscalScopeBindingRequired).toBe(true);
    expect(handoff.readinessRequiredBeforeIssuance).toBe(true);
    expect(handoff.idempotencyKey).toBe('vendedor-ia:payment:payment-1:sale:v1');
    expect(handoff).not.toHaveProperty('providerId');
    expect(handoff).not.toHaveProperty('municipalityCode');
    expect(handoff).not.toHaveProperty('productionApproved');
  });

  it('bloqueia conteudo de servico fora do contract pack sales sem mascarar como venda fiscal pronta', async () => {
    const handoffs = new HandoffRepo();
    const service = new SalesFiscalHandoffService(handoffs, new QuoteRepo(quote()), new ItemRepo([item('SERVICE')]));
    await service.onConfirmed(payment());
    expect(handoffs.records[0].state).toBe('BLOCKED_UNSUPPORTED_SALE_CONTENT');
  });

  it('rejeita divergencia entre pagamento confirmado e quote fonte', async () => {
    const handoffs = new HandoffRepo();
    const mismatched = { ...payment(), amountMinor: 8000 };
    const service = new SalesFiscalHandoffService(handoffs, new QuoteRepo(quote()), new ItemRepo([item()]));
    await expect(service.onConfirmed(mismatched)).rejects.toMatchObject({ code: 'FISCAL_SETTLEMENT_SOURCE_MISMATCH' });
    expect(handoffs.records).toHaveLength(0);
  });
});
