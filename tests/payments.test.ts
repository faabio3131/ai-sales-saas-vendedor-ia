import { describe, expect, it } from 'vitest';
import { Quote } from '../src/quotes/model';
import { QuoteRepository } from '../src/quotes/contracts';
import { InMemoryPaymentRepository, InMemoryPaymentWebhookEventRepository } from '../src/payments/repository';
import { PaymentProviderInterface } from '../src/payments/contracts';
import { NormalizedPaymentWebhook, ProviderPaymentRequest, ProviderPaymentResult } from '../src/payments/model';
import { PaymentService } from '../src/payments/service';
import { TenantContext } from '../src/types/contracts';

const ctx = (tenantId: string): TenantContext => ({ tenantId, requestId: `req-${tenantId}` });

function acceptedQuote(tenantId = 'tenant-a'): Quote {
  return {
    id: 'q1', tenantId, customerId: 'c1', status: 'ACCEPTED', currency: 'BRL',
    subtotalMinor: 5000, discountMinor: 500, totalMinor: 4500,
    createdAt: '2026-08-29T00:00:00.000Z', updatedAt: '2026-08-29T00:00:00.000Z', acceptedAt: '2026-08-29T00:00:00.000Z',
  };
}

class FakeQuoteRepository implements QuoteRepository {
  constructor(private readonly quote: Quote = acceptedQuote()) {}
  async listByTenant(tenantId: string) { return this.quote.tenantId === tenantId ? [this.quote] : []; }
  async findById(tenantId: string, id: string) { return this.quote.tenantId === tenantId && this.quote.id === id ? this.quote : null; }
  async create(q: Quote) { return q; }
  async update(q: Quote) { return q; }
}

class FakeProvider implements PaymentProviderInterface {
  readonly id = 'FAKEPAY';
  createCalls = 0;
  validWebhook = true;
  webhook: NormalizedPaymentWebhook = { eventId:'evt-1', providerPaymentId:'pp-1', status:'CONFIRMED', occurredAt:'2026-08-29T00:01:00.000Z' };
  private result(): ProviderPaymentResult { return { provider:this.id, providerPaymentId:'pp-1', status:'PENDING', pixCode:'pix-copy-paste', paymentUrl:'https://example.invalid/pay' }; }
  async createPix(_input: ProviderPaymentRequest) { this.createCalls++; return this.result(); }
  async createPaymentLink(_input: ProviderPaymentRequest) { this.createCalls++; return this.result(); }
  async createCheckout(_input: ProviderPaymentRequest) { return this.result(); }
  async getPaymentStatus(_id: string) { return { ...this.result(), status:'CONFIRMED' as const }; }
  async cancelPayment(_id: string) { return { ...this.result(), status:'CANCELLED' as const }; }
  async refundPayment(_id: string) { return { ...this.result(), status:'CONFIRMED' as const }; }
  async validateWebhook() { return this.validWebhook; }
  async normalizeWebhook() { return this.webhook; }
}

function fixture(quote = acceptedQuote()) {
  const payments = new InMemoryPaymentRepository();
  const events = new InMemoryPaymentWebhookEventRepository();
  const provider = new FakeProvider();
  const service = new PaymentService(payments, events, new FakeQuoteRepository(quote), provider);
  return { service, payments, events, provider };
}

describe('BLK-150 Payments', () => {
  it('cria Pix somente a partir de quote aceita e usa valor do domínio', async () => {
    const { service } = fixture();
    const payment = await service.create(ctx('tenant-a'), { quoteId:'q1', method:'PIX', idempotencyKey:'pay-1' });
    expect(payment.amountMinor).toBe(4500);
    expect(payment.currency).toBe('BRL');
    expect(payment.status).toBe('PENDING');
    expect(payment.pixCode).toBe('pix-copy-paste');
  });

  it('é idempotente por tenant e idempotencyKey', async () => {
    const { service, provider } = fixture();
    const first = await service.create(ctx('tenant-a'), { quoteId:'q1', method:'PIX', idempotencyKey:'same-key' });
    const second = await service.create(ctx('tenant-a'), { quoteId:'q1', method:'PIX', idempotencyKey:'same-key' });
    expect(second.id).toBe(first.id);
    expect(provider.createCalls).toBe(1);
  });

  it('bloqueia quote não aceita e acesso cross-tenant', async () => {
    const draft = { ...acceptedQuote(), status:'DRAFT' as const };
    await expect(fixture(draft).service.create(ctx('tenant-a'), { quoteId:'q1', method:'PIX', idempotencyKey:'x' })).rejects.toMatchObject({ code:'QUOTE_NOT_ACCEPTED' });
    const { service } = fixture();
    const created = await service.create(ctx('tenant-a'), { quoteId:'q1', method:'PIX', idempotencyKey:'a' });
    await expect(service.get(ctx('tenant-b'), created.id)).rejects.toMatchObject({ code:'PAYMENT_NOT_FOUND' });
  });

  it('confirma somente por consulta server-side ao provider', async () => {
    const { service } = fixture();
    const created = await service.create(ctx('tenant-a'), { quoteId:'q1', method:'PAYMENT_LINK', idempotencyKey:'refresh-1' });
    expect(created.status).toBe('PENDING');
    const refreshed = await service.refresh(ctx('tenant-a'), created.id);
    expect(refreshed.status).toBe('CONFIRMED');
    expect(refreshed.confirmedAt).toBeTruthy();
  });

  it('valida webhook e processa eventId duplicado uma única vez', async () => {
    const { service } = fixture();
    const created = await service.create(ctx('tenant-a'), { quoteId:'q1', method:'PIX', idempotencyKey:'webhook-1' });
    const once = await service.handleWebhook(ctx('tenant-a'), { 'x-signature':'ok' }, { any:'payload' });
    expect(once.id).toBe(created.id);
    expect(once.status).toBe('CONFIRMED');
    const twice = await service.handleWebhook(ctx('tenant-a'), { 'x-signature':'ok' }, { any:'payload' });
    expect(twice.id).toBe(created.id);
    expect(twice.confirmedAt).toBe(once.confirmedAt);
  });

  it('rejeita webhook inválido antes de normalizar ou confirmar', async () => {
    const { service, provider } = fixture();
    await service.create(ctx('tenant-a'), { quoteId:'q1', method:'PIX', idempotencyKey:'invalid-hook' });
    provider.validWebhook = false;
    await expect(service.handleWebhook(ctx('tenant-a'), {}, {})).rejects.toMatchObject({ code:'PAYMENT_WEBHOOK_INVALID' });
    const listed = await service.list(ctx('tenant-a'));
    expect(listed[0].status).toBe('PENDING');
  });
});
