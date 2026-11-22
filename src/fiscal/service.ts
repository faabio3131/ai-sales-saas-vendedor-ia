import { ApplicationError } from '../infrastructure/errors';
import { Payment } from '../payments/model';
import { QuoteItemRepository, QuoteRepository } from '../quotes/contracts';
import { PaymentConfirmationObserver, SalesFiscalHandoffRepository } from './contracts';
import { SalesFiscalHandoff } from './model';

const HOST_NAMESPACE = 'fm.vendedor-ia' as const;
const PACK_ID = 'sales' as const;
const ALLOWED_USE_CASES = ['nfce-sale', 'nfe-sale'] as const;
const ALLOWED_DOCUMENT_KINDS = ['nfce', 'nfe'] as const;

export class SalesFiscalHandoffService implements PaymentConfirmationObserver {
  constructor(
    private readonly handoffs: SalesFiscalHandoffRepository,
    private readonly quotes: QuoteRepository,
    private readonly quoteItems: QuoteItemRepository,
  ) {}

  async onConfirmed(payment: Payment): Promise<void> {
    if (payment.status !== 'CONFIRMED') return;
    if (!payment.confirmedAt) {
      throw new ApplicationError({
        category: 'CONFLICT',
        code: 'PAYMENT_CONFIRMATION_TIMESTAMP_REQUIRED',
        message: 'Confirmed payment requires confirmedAt before fiscal handoff.',
      });
    }

    const idempotencyKey = `vendedor-ia:payment:${payment.id}:sale:v1`;
    const existing = await this.handoffs.findByIdempotencyKey(payment.tenantId, idempotencyKey);
    if (existing) {
      if (existing.tenantId !== payment.tenantId ||
          existing.paymentId !== payment.id || existing.quoteId !== payment.quoteId ||
          existing.customerId !== payment.customerId ||
          existing.amountMinor !== payment.amountMinor ||
          existing.currency !== payment.currency ||
          existing.paymentConfirmedAt !== payment.confirmedAt) {
        throw new ApplicationError({category:'CONFLICT',code:'FISCAL_HANDOFF_IDEMPOTENCY_CONFLICT',
          message:'Persisted fiscal event differs from the settled payment.'});
      }
      return;
    }

    const quote = await this.quotes.findById(payment.tenantId, payment.quoteId);
    if (!quote) {
      throw new ApplicationError({
        category: 'NOT_FOUND',
        code: 'FISCAL_SOURCE_QUOTE_NOT_FOUND',
        message: 'Source quote was not found for confirmed payment.',
      });
    }
    if (quote.status !== 'ACCEPTED') {
      throw new ApplicationError({
        category: 'CONFLICT',
        code: 'FISCAL_SOURCE_QUOTE_NOT_ACCEPTED',
        message: 'Fiscal handoff requires an accepted quote.',
      });
    }
    if (quote.customerId !== payment.customerId || quote.totalMinor !== payment.amountMinor || quote.currency !== payment.currency) {
      throw new ApplicationError({
        category: 'CONFLICT',
        code: 'FISCAL_SETTLEMENT_SOURCE_MISMATCH',
        message: 'Confirmed payment no longer matches its source quote.',
      });
    }

    const items = await this.quoteItems.listByQuote(payment.tenantId, quote.id);
    if (items.length === 0) {
      throw new ApplicationError({
        category: 'CONFLICT',
        code: 'FISCAL_SOURCE_ITEMS_REQUIRED',
        message: 'Fiscal handoff requires the accepted quote item snapshot.',
      });
    }

    const hasServiceItem = items.some((item) => item.itemType === 'SERVICE');
    const now = new Date().toISOString();
    const handoff: SalesFiscalHandoff = {
      id: `sales-fiscal-${payment.id}`,
      tenantId: payment.tenantId,
      hostNamespace: HOST_NAMESPACE,
      packId: PACK_ID,
      operationKind: 'sale',
      allowedUseCaseIds: ALLOWED_USE_CASES,
      allowedDocumentKinds: ALLOWED_DOCUMENT_KINDS,
      state: hasServiceItem ? 'BLOCKED_UNSUPPORTED_SALE_CONTENT' : 'PENDING_FISCAL_CLASSIFICATION',
      paymentId: payment.id,
      quoteId: quote.id,
      customerId: payment.customerId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      paymentConfirmedAt: payment.confirmedAt,
      items: items.map((item) => ({
        itemType: item.itemType,
        productId: item.productId,
        serviceId: item.serviceId,
        description: item.descriptionSnapshot,
        quantity: item.quantity,
        unitPriceMinor: item.unitPriceMinor,
        totalMinor: item.totalMinor,
      })),
      idempotencyKey,
      documentSelectionRequired: true,
      fiscalRecipientDataRequired: true,
      fiscalScopeBindingRequired: true,
      readinessRequiredBeforeIssuance: true,
      capabilitiesPath: '/v1/capabilities/query',
      issuancePath: '/v1/issuances',
      createdAt: now,
      updatedAt: now,
    };

    await this.handoffs.create(handoff);
  }
}
