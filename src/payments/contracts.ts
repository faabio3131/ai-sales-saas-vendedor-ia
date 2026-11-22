import { NormalizedPaymentWebhook, Payment, PaymentStatus, PaymentWebhookEvent, ProviderPaymentRequest, ProviderPaymentResult } from './model';

export interface PaymentRepository {
  listByTenant(tenantId: string): Promise<Payment[]>;
  findById(tenantId: string, id: string): Promise<Payment | null>;
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Payment | null>;
  findByProviderPaymentId(tenantId: string, provider: string, providerPaymentId: string): Promise<Payment | null>;
  create(payment: Payment): Promise<Payment>;
  update(payment: Payment, expectedStatus?: PaymentStatus): Promise<Payment>;
}

export interface PaymentWebhookEventRepository {
  findByEventId(tenantId: string, provider: string, eventId: string): Promise<PaymentWebhookEvent | null>;
  create(event: PaymentWebhookEvent): Promise<PaymentWebhookEvent>;
}

export interface PaymentProviderInterface {
  readonly id: string;
  /** Explicit capability negotiation; absent means Pix-only by default. */
  readonly supportedMethods?: ReadonlyArray<'PIX'|'PAYMENT_LINK'|'CHECKOUT'>;
  /** Optional read-only validation before reserving an external payment intent. */
  preflightPix?(input:ProviderPaymentRequest):Promise<void>;
  createPix(input: ProviderPaymentRequest): Promise<ProviderPaymentResult>;
  createPaymentLink(input: ProviderPaymentRequest): Promise<ProviderPaymentResult>;
  createCheckout(input: ProviderPaymentRequest): Promise<ProviderPaymentResult>;
  getPaymentStatus(providerPaymentId: string): Promise<ProviderPaymentResult>;
  cancelPayment(providerPaymentId: string): Promise<ProviderPaymentResult>;
  refundPayment(providerPaymentId: string): Promise<ProviderPaymentResult>;
  validateWebhook(headers: Record<string, string | string[] | undefined>, payload: unknown): Promise<boolean>;
  normalizeWebhook(payload: unknown): Promise<NormalizedPaymentWebhook>;
}
