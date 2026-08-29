export type ExpansionType = 'UPSELL' | 'CROSS_SELL';
export type ExpansionStatus = 'SUGGESTED' | 'APPROVAL_REQUIRED' | 'APPROVED' | 'ATTRIBUTED' | 'DISMISSED';

export interface RevenueExpansion {
  id: string;
  tenantId: string;
  customerId: string;
  opportunityId?: string;
  type: ExpansionType;
  catalogItemId: string;
  catalogItemName: string;
  suggestedAmountMinor: number;
  currency: 'BRL';
  reason: string;
  policyReasonCode: string;
  requiresHumanApproval: boolean;
  status: ExpansionStatus;
  attributedPaymentId?: string;
  attributedRevenueMinor?: number;
  attributedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuggestExpansionInput {
  customerId: string;
  opportunityId?: string;
  type: ExpansionType;
  catalogItemId: string;
  reason?: string;
}
