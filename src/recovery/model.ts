export type RecoveryCandidateStatus = 'OPEN' | 'ACTION_PREPARED' | 'RECOVERED' | 'DISMISSED';
export type RecoveryActionStatus = 'PREPARED' | 'APPROVAL_REQUIRED' | 'APPROVED' | 'COMPLETED' | 'CANCELLED';

export interface RecoveryCandidate {
  id: string;
  tenantId: string;
  customerId: string;
  opportunityId: string;
  leadId?: string;
  reason: string;
  evidence: string[];
  strategy: string;
  status: RecoveryCandidateStatus;
  detectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecoveryAction {
  id: string;
  tenantId: string;
  candidateId: string;
  customerId: string;
  opportunityId: string;
  strategy: string;
  policyReasonCode: string;
  requiresHumanApproval: boolean;
  status: RecoveryActionStatus;
  createdAt: string;
  updatedAt: string;
}
