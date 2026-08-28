import { FunnelStage } from '../leads/model';

export type AttentionKind = 'FOLLOW_UP_DUE' | 'OPPORTUNITY_DUE' | 'RECOVERY_OPEN';

export interface AttentionItem {
  kind: AttentionKind;
  entityId: string;
  customerId: string;
  opportunityId?: string;
  dueAt?: string;
  reason: string;
}

export interface DashboardMetrics {
  leadsTotal: number;
  opportunitiesOpen: number;
  pipelineValueMinor: number;
  followUpsDue: number;
  recoveryOpen: number;
  funnel: Partial<Record<FunnelStage, number>>;
}

export interface DashboardSnapshot {
  tenantId: string;
  generatedAt: string;
  attention: AttentionItem[];
  metrics: DashboardMetrics;
}
