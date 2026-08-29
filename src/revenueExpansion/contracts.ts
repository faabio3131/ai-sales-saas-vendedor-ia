import { RevenueExpansion } from './model';

export interface RevenueExpansionRepository {
  listByTenant(tenantId: string): Promise<RevenueExpansion[]>;
  findById(tenantId: string, id: string): Promise<RevenueExpansion | null>;
  findByPaymentId(tenantId: string, paymentId: string): Promise<RevenueExpansion | null>;
  create(expansion: RevenueExpansion): Promise<RevenueExpansion>;
  update(expansion: RevenueExpansion): Promise<RevenueExpansion>;
}
