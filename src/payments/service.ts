import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../infrastructure/errors';
import { QuoteRepository } from '../quotes/contracts';
import { TenantContext } from '../types/contracts';
import { PaymentProviderInterface, PaymentRepository, PaymentWebhookEventRepository } from './contracts';
import { CreatePaymentInput, Payment, PaymentStatus } from './model';

export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly webhookEvents: PaymentWebhookEventRepository,
    private readonly quotes: QuoteRepository,
    private readonly provider: PaymentProviderInterface,
  ) {}

  private tenant(context: TenantContext): string {
    const tenantId = context.tenantId?.trim();
    if (!tenantId) throw new ApplicationError({ category:'FORBIDDEN', code:'TENANT_CONTEXT_REQUIRED', message:'Tenant context is required.' });
    return tenantId;
  }

  async list(context: TenantContext) { return this.payments.listByTenant(this.tenant(context)); }

  async get(context: TenantContext, id: string) {
    const payment = await this.payments.findById(this.tenant(context), id);
    if (!payment) throw new ApplicationError({ category:'NOT_FOUND', code:'PAYMENT_NOT_FOUND', message:'Payment not found.' });
    return payment;
  }

  async create(context: TenantContext, input: CreatePaymentInput): Promise<Payment> {
    const tenantId = this.tenant(context);
    const key = input.idempotencyKey?.trim();
    if (!key) throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_IDEMPOTENCY_REQUIRED', message:'Idempotency key is required.' });
    if (input.method !== 'PIX' && input.method !== 'PAYMENT_LINK') throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_METHOD_INVALID', message:'Payment method is invalid.' });
    const existing = await this.payments.findByIdempotencyKey(tenantId, key);
    if (existing) return existing;

    const quote = await this.quotes.findById(tenantId, input.quoteId);
    if (!quote) throw new ApplicationError({ category:'NOT_FOUND', code:'QUOTE_NOT_FOUND', message:'Quote not found.' });
    if (quote.status !== 'ACCEPTED') throw new ApplicationError({ category:'CONFLICT', code:'QUOTE_NOT_ACCEPTED', message:'Quote must be accepted before payment creation.' });
    if (quote.totalMinor <= 0) throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_AMOUNT_INVALID', message:'Payment amount must be positive.' });

    const request = {
      tenantId,
      customerId: quote.customerId,
      referenceId: quote.id,
      amountMinor: quote.totalMinor,
      currency: quote.currency,
      idempotencyKey: key,
    } as const;

    let providerResult;
    try {
      providerResult = input.method === 'PIX'
        ? await this.provider.createPix(request)
        : await this.provider.createPaymentLink(request);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError({ category:'PROVIDER', code:'PAYMENT_PROVIDER_ERROR', message:'Payment provider failed.', retryable:true });
    }

    const now = new Date().toISOString();
    return this.payments.create({
      id: randomUUID(),
      tenantId,
      customerId: quote.customerId,
      quoteId: quote.id,
      provider: providerResult.provider,
      providerPaymentId: providerResult.providerPaymentId,
      method: input.method,
      status: providerResult.status,
      amountMinor: quote.totalMinor,
      currency: quote.currency,
      idempotencyKey: key,
      paymentUrl: providerResult.paymentUrl,
      pixCode: providerResult.pixCode,
      expiresAt: providerResult.expiresAt,
      confirmedAt: providerResult.status === 'CONFIRMED' ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
  }

  async refresh(context: TenantContext, id: string): Promise<Payment> {
    const payment = await this.get(context, id);
    if (!payment.providerPaymentId) return payment;
    let result;
    try { result = await this.provider.getPaymentStatus(payment.providerPaymentId); }
    catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError({ category:'PROVIDER', code:'PAYMENT_PROVIDER_ERROR', message:'Payment provider failed.', retryable:true });
    }
    return this.applyStatus(payment, result.status);
  }

  private async applyStatus(payment: Payment, status: PaymentStatus): Promise<Payment> {
    const now = new Date().toISOString();
    const updated: Payment = {
      ...payment,
      status,
      confirmedAt: status === 'CONFIRMED' ? (payment.confirmedAt ?? now) : payment.confirmedAt,
      updatedAt: now,
    };
    return this.payments.update(updated);
  }

  async handleWebhook(context: TenantContext, headers: Record<string, string | string[] | undefined>, payload: unknown): Promise<Payment> {
    const tenantId = this.tenant(context);
    const valid = await this.provider.validateWebhook(headers, payload);
    if (!valid) throw new ApplicationError({ category:'FORBIDDEN', code:'PAYMENT_WEBHOOK_INVALID', message:'Payment webhook is invalid.' });

    let normalized;
    try { normalized = await this.provider.normalizeWebhook(payload); }
    catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError({ category:'PROVIDER', code:'PAYMENT_WEBHOOK_NORMALIZATION_FAILED', message:'Payment webhook could not be normalized.' });
    }

    const duplicate = await this.webhookEvents.findByEventId(tenantId, this.provider.id, normalized.eventId);
    const payment = await this.payments.findByProviderPaymentId(tenantId, this.provider.id, normalized.providerPaymentId);
    if (!payment) throw new ApplicationError({ category:'NOT_FOUND', code:'PAYMENT_NOT_FOUND', message:'Payment not found.' });
    if (duplicate) return payment;

    await this.webhookEvents.create({
      id: randomUUID(), tenantId, provider: this.provider.id, eventId: normalized.eventId,
      providerPaymentId: normalized.providerPaymentId, receivedAt: new Date().toISOString(),
    });
    return this.applyStatus(payment, normalized.status);
  }
}
