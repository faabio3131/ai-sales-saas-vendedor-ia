import { RecoveryAction, RecoveryCandidate } from './model';

export interface RecoveryCandidateRepository {
  listByTenant(tenantId: string): Promise<RecoveryCandidate[]>;
  findById(tenantId: string, id: string): Promise<RecoveryCandidate | null>;
  findOpenByOpportunity(tenantId: string, opportunityId: string): Promise<RecoveryCandidate | null>;
  create(candidate: RecoveryCandidate): Promise<RecoveryCandidate>;
  update(candidate: RecoveryCandidate): Promise<RecoveryCandidate>;
}

export interface RecoveryActionRepository {
  listByCandidate(tenantId: string, candidateId: string): Promise<RecoveryAction[]>;
  create(action: RecoveryAction): Promise<RecoveryAction>;
}
