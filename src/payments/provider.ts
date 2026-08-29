import { ApplicationError } from '../infrastructure/errors';
import { PaymentProviderInterface } from './contracts';
import { NormalizedPaymentWebhook, ProviderPaymentRequest, ProviderPaymentResult } from './model';

/**
 * Structural provider used until a real acquiring provider is explicitly approved.
 * It never performs external I/O and therefore cannot create real charges.
 */
export class StructuralPaymentProvider implements PaymentProviderInterface {
  readonly id = 'STRUCTURAL';

  private unavailable(): never {
    throw new ApplicationError({
      category: 'PROVIDER',
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      message: 'Payment provider is not configured.',
      retryable: false,
    });
  }

  async createPix(_input: ProviderPaymentRequest): Promise<ProviderPaymentResult> { return this.unavailable(); }
  async createPaymentLink(_input: ProviderPaymentRequest): Promise<ProviderPaymentResult> { return this.unavailable(); }
  async createCheckout(_input: ProviderPaymentRequest): Promise<ProviderPaymentResult> { return this.unavailable(); }
  async getPaymentStatus(_providerPaymentId: string): Promise<ProviderPaymentResult> { return this.unavailable(); }
  async cancelPayment(_providerPaymentId: string): Promise<ProviderPaymentResult> { return this.unavailable(); }
  async refundPayment(_providerPaymentId: string): Promise<ProviderPaymentResult> { return this.unavailable(); }
  async validateWebhook(_headers: Record<string, string | string[] | undefined>, _payload: unknown): Promise<boolean> { return false; }
  async normalizeWebhook(_payload: unknown): Promise<NormalizedPaymentWebhook> { return this.unavailable(); }
}
