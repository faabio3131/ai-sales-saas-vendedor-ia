import { randomUUID, createHash } from 'node:crypto';
import type { PaymentConfirmationObserver } from '../fiscal/contracts';
import { ApplicationError } from '../infrastructure/errors';
import { QuoteRepository } from '../quotes/contracts';
import { TenantContext } from '../types/contracts';
import { PaymentProviderInterface, PaymentRepository, PaymentWebhookEventRepository } from './contracts';
import { CreatePaymentInput, Payment, PaymentStatus } from './model';
import { PaymentMethodsService } from './methods';
import type {PaymentProviderResolver} from './resolver';
import type {PaymentCreationIntentRepository} from './creationIntent';

export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly webhookEvents: PaymentWebhookEventRepository,
    private readonly quotes: QuoteRepository,
    private readonly provider: PaymentProviderInterface,
    private readonly confirmationObserver?: PaymentConfirmationObserver,
    private readonly methodSettings?: PaymentMethodsService,
    private readonly providerResolver?: PaymentProviderResolver,
    private readonly creationIntents?:PaymentCreationIntentRepository,
  ) {}

  private tenant(context: TenantContext): string {
    const tenantId = context.tenantId?.trim();
    if (!tenantId) throw new ApplicationError({ category:'FORBIDDEN', code:'TENANT_CONTEXT_REQUIRED', message:'Tenant context is required.' });
    return tenantId;
  }

  private async notifyConfirmed(payment: Payment): Promise<void> {
    if (payment.status === 'CONFIRMED' && this.confirmationObserver) {
      await this.confirmationObserver.onConfirmed(payment);
    }
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
    if (!['PIX', 'PAYMENT_LINK', 'PIX_MANUAL', 'CARD_ON_DELIVERY', 'CASH_ON_DELIVERY'].includes(input.method)) throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_METHOD_INVALID', message:'Payment method is invalid.' });
    if(key.length>128) throw new ApplicationError({category:'VALIDATION',code:'PAYMENT_IDEMPOTENCY_INVALID',message:'Invalid idempotency key.'});
    const paymentId=createHash('sha256').update(tenantId+'\\0'+key).digest('hex');
    const existing = await this.payments.findByIdempotencyKey(tenantId, key);
    if (existing) {
      if (existing.quoteId !== input.quoteId || existing.method !== input.method) throw new ApplicationError({ category:'CONFLICT', code:'PAYMENT_IDEMPOTENCY_CONFLICT', message:'Idempotency key already belongs to another payment.' });
      await this.notifyConfirmed(existing);
      return existing;
    }

    const quote = await this.quotes.findById(tenantId, input.quoteId);
    if (!quote) throw new ApplicationError({ category:'NOT_FOUND', code:'QUOTE_NOT_FOUND', message:'Quote not found.' });
    if (quote.status !== 'ACCEPTED') throw new ApplicationError({ category:'CONFLICT', code:'QUOTE_NOT_ACCEPTED', message:'Quote must be accepted before payment creation.' });
    if (quote.totalMinor <= 0) throw new ApplicationError({ category:'VALIDATION', code:'PAYMENT_AMOUNT_INVALID', message:'Payment amount must be positive.' });

    if (input.method === 'PIX_MANUAL' || input.method === 'CARD_ON_DELIVERY' || input.method === 'CASH_ON_DELIVERY') {
      if (!this.methodSettings || !(await this.methodSettings.isEnabled(tenantId, input.method))) {
        throw new ApplicationError({ category:'FORBIDDEN', code:'PAYMENT_METHOD_DISABLED', message:'Payment method has not been enabled for this business.' });
      }
      // Never generate a fictitious bank payment ID or mark an offline payment as paid.
      const now = new Date().toISOString();
      return this.payments.create({
        id: paymentId, tenantId, customerId: quote.customerId, quoteId: quote.id,
        provider: 'OFFLINE', method: input.method, status: 'PENDING',
        amountMinor: quote.totalMinor, currency: quote.currency,
        idempotencyKey: key, createdAt: now, updatedAt: now,
      });
    }

    const request = {
      payerEmail:input.payerEmail,
      tenantId,
      customerId: quote.customerId,
      referenceId: quote.id,
      amountMinor: quote.totalMinor,
      currency: quote.currency,
      idempotencyKey: key,
    } as const;

    let providerResult;
    try {
      const provider=this.providerResolver ? await this.providerResolver.forNewPayment(tenantId,input.providerId) : this.provider;
      // Claim before non-atomic external I/O: unknown outcomes must be reconciled, not retried blindly.
      if(this.creationIntents)await this.creationIntents.reserve({
        tenantId,paymentId,quoteId:quote.id,method:input.method,providerId:provider.id,
        createdAt:new Date().toISOString(),
      });
      providerResult = input.method === 'PIX'
        ? await provider.createPix(request)
        : await provider.createPaymentLink(request);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError({ category:'PROVIDER', code:'PAYMENT_PROVIDER_ERROR', message:'Payment provider failed.', retryable:true });
    }

    const now = new Date().toISOString();
    const payment = await this.payments.create({
      id: paymentId,
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
      pixQrCodeBase64: providerResult.pixQrCodeBase64,
      expiresAt: providerResult.expiresAt,
      confirmedAt: providerResult.status === 'CONFIRMED' ? now : undefined,
      createdAt: now,
      updatedAt: now,
    });
    await this.notifyConfirmed(payment);
    return payment;
  }

  async refresh(context: TenantContext, id: string): Promise<Payment> {
    const payment = await this.get(context, id);
    if (!payment.providerPaymentId) return payment;
    let result;
    try { const provider=this.providerResolver ? await this.providerResolver.forRecordedPayment(payment) : this.provider;
      result = await provider.getPaymentStatus(payment.providerPaymentId); }
    catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError({ category:'PROVIDER', code:'PAYMENT_PROVIDER_ERROR', message:'Payment provider failed.', retryable:true });
    }
    this.assertVerified(payment,result);
    return this.applyStatus(payment, result.status);
  }

  private assertVerified(payment:Payment, result: import('./model').ProviderPaymentResult):void {
    if(result.provider!==payment.provider || result.providerPaymentId!==payment.providerPaymentId ||
      (['MERCADOPAGO','EFI','ASAAS','BANCO_INTER','BANCO_DO_BRASIL','PAGARME'].includes(payment.provider) &&
        (result.amountMinor!==payment.amountMinor ||
         result.referenceId!==payment.tenantId+':'+payment.quoteId))) {
      throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_PROVIDER_RECONCILIATION_FAILED',message:'Payment verification failed.'});
    }
  }

  private async applyStatus(payment: Payment, status: PaymentStatus): Promise<Payment> {
    if(payment.status==='CONFIRMED' && status!=='REFUNDED') {
      await this.notifyConfirmed(payment);
      return payment;
    }
    if(payment.status==='REFUNDED' ||
      (['FAILED','CANCELLED','EXPIRED'].includes(payment.status)&&status==='PENDING')) return payment;
    if(payment.status===status) {
      // Downstream observer is idempotent and may need a safe retry after an earlier failure.
      if(status==='CONFIRMED') await this.notifyConfirmed(payment);
      return payment;
    }

    const now = new Date().toISOString();
    const updated: Payment = {
      ...payment,
      status,
      confirmedAt: status === 'CONFIRMED' ? (payment.confirmedAt ?? now) : payment.confirmedAt,
      updatedAt: now,
    };
    const persisted = await this.payments.update(updated);
    await this.notifyConfirmed(persisted);
    return persisted;
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
    if (duplicate && (payment.status === 'CONFIRMED' || payment.status === 'REFUNDED')) {
      if(payment.status==='CONFIRMED') await this.notifyConfirmed(payment);
      return payment;
    }

    const verified = await this.provider.getPaymentStatus(normalized.providerPaymentId);
    this.assertVerified(payment,verified);

    if (!duplicate) await this.webhookEvents.create({
      id: randomUUID(), tenantId, provider: this.provider.id, eventId: normalized.eventId,
      providerPaymentId: normalized.providerPaymentId, receivedAt: new Date().toISOString(),
    });
    return this.applyStatus(payment, verified.status);
  }
}
