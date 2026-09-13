import { Payment } from '../payments/model';
import { SalesFiscalHandoff } from './model';

export interface SalesFiscalHandoffRepository {
  findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<SalesFiscalHandoff | null>;
  create(handoff: SalesFiscalHandoff): Promise<SalesFiscalHandoff>;
}

export interface PaymentConfirmationObserver {
  onConfirmed(payment: Payment): Promise<void>;
}
