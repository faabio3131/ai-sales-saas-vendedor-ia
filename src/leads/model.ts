export const FUNNEL_STAGES = ['NOVO','CONVERSANDO','QUALIFICADO','PROPOSTA','AGUARDANDO_CLIENTE','FECHADO','RECUPERACAO','PERDIDO'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface Lead {
  id: string;
  tenantId: string;
  customerId: string;
  conversationId?: string;
  stage: FunnelStage;
  interest?: string;
  purchaseIntent?: string;
  urgency?: string;
  budgetMinor?: number;
  objection?: string;
  sentiment?: string;
  nextAction?: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
}

export interface Opportunity {
  id: string;
  tenantId: string;
  customerId: string;
  leadId?: string;
  stage: FunnelStage;
  title?: string;
  estimatedValueMinor?: number;
  currency: 'BRL';
  nextAction?: string;
  nextActionAt?: string;
  lostReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadCandidate {
  interest?: string;
  purchaseIntent?: string;
  urgency?: string;
  budgetMinor?: number;
  objection?: string;
  sentiment?: string;
  nextAction?: string;
  confidence?: number;
}
