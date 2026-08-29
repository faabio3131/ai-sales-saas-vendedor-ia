import { PaymentRepository, PaymentWebhookEventRepository } from './contracts';
import { Payment, PaymentWebhookEvent } from './model';

export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly items = new Map<string, Payment>();
  async listByTenant(tenantId: string) { return [...this.items.values()].filter(p => p.tenantId === tenantId); }
  async findById(tenantId: string, id: string) { const p = this.items.get(id); return p?.tenantId === tenantId ? p : null; }
  async findByIdempotencyKey(tenantId: string, key: string) { return [...this.items.values()].find(p => p.tenantId === tenantId && p.idempotencyKey === key) ?? null; }
  async findByProviderPaymentId(tenantId: string, provider: string, providerPaymentId: string) { return [...this.items.values()].find(p => p.tenantId === tenantId && p.provider === provider && p.providerPaymentId === providerPaymentId) ?? null; }
  async create(payment: Payment) { this.items.set(payment.id, payment); return payment; }
  async update(payment: Payment) { this.items.set(payment.id, payment); return payment; }
}

export class InMemoryPaymentWebhookEventRepository implements PaymentWebhookEventRepository {
  private readonly items: PaymentWebhookEvent[] = [];
  async findByEventId(tenantId: string, provider: string, eventId: string) { return this.items.find(e => e.tenantId === tenantId && e.provider === provider && e.eventId === eventId) ?? null; }
  async create(event: PaymentWebhookEvent) { this.items.push(event); return event; }
}
