export type PaymentMethod = 'PIX' | 'PAYMENT_LINK' | 'CHECKOUT' | 'PIX_MANUAL' | 'CARD_ON_DELIVERY' | 'CASH_ON_DELIVERY';
export type PaymentStatus = 'CREATED' | 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';

export interface Payment {
  id: string;
  tenantId: string;
  customerId: string;
  quoteId: string;
  saleId?: string;
  provider: string;
  providerPaymentId?: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountMinor: number;
  currency: 'BRL';
  idempotencyKey: string;
  paymentUrl?: string;
  pixCode?: string;
  pixQrCodeBase64?: string;
  expiresAt?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentInput {
  quoteId: string;
  method: 'PIX' | 'PAYMENT_LINK' | 'PIX_MANUAL' | 'CARD_ON_DELIVERY' | 'CASH_ON_DELIVERY';
  idempotencyKey: string;
  payerEmail?: string;
  providerId?: string;
}

export interface ProviderPaymentRequest {
  tenantId: string;
  customerId: string;
  referenceId: string;
  amountMinor: number;
  currency: 'BRL';
  idempotencyKey: string;
  payerEmail?: string;
}

export interface ProviderPaymentResult {
  provider: string;
  providerPaymentId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  paymentUrl?: string;
  pixCode?: string;
  pixQrCodeBase64?: string;
  amountMinor?: number;
  referenceId?: string;
  expiresAt?: string;
}

export interface NormalizedPaymentWebhook {
  eventId: string;
  providerPaymentId: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
  occurredAt: string;
}

export interface PaymentWebhookEvent {
  id: string;
  tenantId: string;
  provider: string;
  eventId: string;
  providerPaymentId: string;
  receivedAt: string;
}
