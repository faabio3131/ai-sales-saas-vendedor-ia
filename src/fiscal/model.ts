import { QuoteItemType } from '../quotes/model';

export type SalesFiscalHandoffState =
  | 'PENDING_FISCAL_CLASSIFICATION'
  | 'BLOCKED_UNSUPPORTED_SALE_CONTENT';

export interface SalesFiscalHandoffItem {
  itemType: QuoteItemType;
  productId?: string;
  serviceId?: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export interface SalesFiscalHandoff {
  id: string;
  tenantId: string;
  hostNamespace: 'fm.vendedor-ia';
  packId: 'sales';
  operationKind: 'sale';
  allowedUseCaseIds: readonly ['nfce-sale', 'nfe-sale'];
  allowedDocumentKinds: readonly ['nfce', 'nfe'];
  state: SalesFiscalHandoffState;
  paymentId: string;
  quoteId: string;
  customerId: string;
  amountMinor: number;
  currency: 'BRL';
  paymentConfirmedAt: string;
  items: SalesFiscalHandoffItem[];
  idempotencyKey: string;
  documentSelectionRequired: true;
  fiscalRecipientDataRequired: true;
  fiscalScopeBindingRequired: true;
  readinessRequiredBeforeIssuance: true;
  capabilitiesPath: '/v1/capabilities/query';
  issuancePath: '/v1/issuances';
  createdAt: string;
  updatedAt: string;
}
