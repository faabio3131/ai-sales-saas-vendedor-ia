import type { Order } from '../orders/model';
import type { OutboxRecord } from '../orderPayments/model';

export type FinancePeriod = 'day'|'week'|'month';
export type FinanceMetric =
  'grossSales'|'netSales'|'confirmedReceipts'|'netReceipts'|'refunds'|
  'discounts'|'pendingReceivables'|'averageTicket'|'orderCount'|'topProducts'|'processingFees';

export interface FinanceUnitSettings {
  tenantId:string;unitId:string;version:number;weekStartsOn:number;updatedAt:string;updatedBy:string;
}
export interface FinanceSources {
  orders:Order[];
  events:OutboxRecord[];
}
export interface FinanceSourceRepository {
  read(tenantId:string,unitId:string):Promise<FinanceSources>;
}
export interface FinanceSettingsRepository {
  get(tenantId:string,unitId:string):Promise<FinanceUnitSettings|null>;
  update(settings:FinanceUnitSettings,expectedVersion:number):Promise<FinanceUnitSettings>;
}
export interface FinancialWindow {
  period:FinancePeriod;anchor:string;timezone:string;weekStartsOn:number;
  startInclusive:string;endExclusive:string;asOf:string;
}
export interface ProductRank {
  catalogItemId:string;name:string;quantity:number;grossItemSalesMinor:number;
}
export interface CommercialMetrics {
  currency:'BRL';
  orderCount:number;grossSalesMinor:number;discountsMinor:number;netSalesMinor:number;
  confirmedReceiptsMinor:number;refundsMinor:number;netReceiptsMinor:number;
  pendingReceivablesMinor:number;averageTicketMinor:number;
  processingFeesMinor:null;netAfterProcessingFeesMinor:null;
  feeCoverage:'NOT_REPORTED_BY_VERIFIED_PSP_FEED';
  platformAICostsIncluded:false;
  ranking:ProductRank[];
}
export interface FinanceSnapshot {
  tenantId:string;unitId:string;generatedAt:string;
  window:FinancialWindow;metrics:CommercialMetrics;
  source:'CANONICAL_ORDERS_AND_TRANSACTIONAL_PAYMENT_OUTBOX';
  coverage:'T03_T04_ORDER_PAYMENTS_ONLY';
  reconciliation:{orders:number;events:number;distinctPayments:number;verifiedEvents:number;errors:number};
}
export interface FinancialAnswer {
  metric:FinanceMetric;question:string;answer:string;source:'DETERMINISTIC_LEDGER';
  snapshot:FinanceSnapshot;
}
