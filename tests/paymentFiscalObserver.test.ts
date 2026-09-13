import { describe, expect, it } from 'vitest';
import { PaymentConfirmationObserver } from '../src/fiscal/contracts';
import { PaymentProviderInterface } from '../src/payments/contracts';
import { NormalizedPaymentWebhook, Payment, ProviderPaymentRequest, ProviderPaymentResult } from '../src/payments/model';
import { InMemoryPaymentRepository, InMemoryPaymentWebhookEventRepository } from '../src/payments/repository';
import { PaymentService } from '../src/payments/service';
import { QuoteRepository } from '../src/quotes/contracts';
import { Quote } from '../src/quotes/model';
import { TenantContext } from '../src/types/contracts';

const context: TenantContext = { tenantId: 'tenant-a', requestId: 'req-a' };
const acceptedQuote: Quote = {
  id: 'quote-a', tenantId: 'tenant-a', customerId: 'customer-a', status: 'ACCEPTED', currency: 'BRL',
  subtotalMinor: 1000, discountMinor: 0, totalMinor: 1000,
  createdAt: '2026-09-13T10:00:00.000Z', updatedAt: '2026-09-13T10:00:00.000Z', acceptedAt: '2026-09-13T10:00:00.000Z',
};

class Quotes implements QuoteRepository {
  async listByTenant(tenantId: string) { return tenantId === acceptedQuote.tenantId ? [acceptedQuote] : []; }
  async findById(tenantId: string, id: string) { return tenantId === acceptedQuote.tenantId && id === acceptedQuote.id ? acceptedQuote : null; }
  async create(quote: Quote) { return quote; }
  async update(quote: Quote) { return quote; }
}

class Provider implements PaymentProviderInterface {
  readonly id = 'FAKE';
  private result(status: ProviderPaymentResult['status']): ProviderPaymentResult {
    return { provider: this.id, providerPaymentId: 'provider-a', status };
  }
  async createPix(_input: ProviderPaymentRequest) { return this.result('PENDING'); }
  async createPaymentLink(_input: ProviderPaymentRequest) { return this.result('PENDING'); }
  async createCheckout(_input: ProviderPaymentRequest) { return this.result('PENDING'); }
  async getPaymentStatus(_providerPaymentId: string) { return this.result('CONFIRMED'); }
  async cancelPayment(_providerPaymentId: string) { return this.result('CANCELLED'); }
  async refundPayment(_providerPaymentId: string) { return this.result('CONFIRMED'); }
  async validateWebhook() { return true; }
  async normalizeWebhook(): Promise<NormalizedPaymentWebhook> {
    return { eventId: 'evt-a', providerPaymentId: 'provider-a', status: 'CONFIRMED', occurredAt: '2026-09-13T10:05:00.000Z' };
  }
}

class Observer implements PaymentConfirmationObserver {
  payments: Payment[] = [];
  async onConfirmed(payment: Payment) { this.payments.push(payment); }
}

describe('V2-16.4 payment-to-fiscal observation', () => {
  it('notifica somente depois da confirmação server-side e permite retry idempotente', async () => {
    const observer = new Observer();
    const service = new PaymentService(
      new InMemoryPaymentRepository(),
      new InMemoryPaymentWebhookEventRepository(),
      new Quotes(),
      new Provider(),
      observer,
    );

    const created = await service.create(context, { quoteId: 'quote-a', method: 'PIX', idempotencyKey: 'request-a' });
    expect(created.status).toBe('PENDING');
    expect(observer.payments).toHaveLength(0);

    const confirmed = await service.refresh(context, created.id);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(observer.payments).toHaveLength(1);
    expect(observer.payments[0].id).toBe(created.id);

    await service.refresh(context, created.id);
    expect(observer.payments).toHaveLength(2);
    expect(observer.payments[1].id).toBe(created.id);
  });
});
