import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { RecoveryActionRepository, RecoveryCandidateRepository } from './contracts';
import { RecoveryAction, RecoveryCandidate } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreRecoveryCandidateRepository implements RecoveryCandidateRepository {
  async listByTenant(tenantId: string): Promise<RecoveryCandidate[]> {
    const s = await db().collection('recoveryCandidates').where('tenantId','==',tenantId).get();
    return s.docs.map(d => d.data() as RecoveryCandidate);
  }
  async findById(tenantId: string, id: string): Promise<RecoveryCandidate | null> {
    const d = await db().collection('recoveryCandidates').doc(id).get();
    if (!d.exists) return null;
    const c = d.data() as RecoveryCandidate;
    return c.tenantId === tenantId ? c : null;
  }
  async findOpenByOpportunity(tenantId: string, opportunityId: string): Promise<RecoveryCandidate | null> {
    const s = await db().collection('recoveryCandidates').where('tenantId','==',tenantId).where('opportunityId','==',opportunityId).get();
    return s.docs.map(d => d.data() as RecoveryCandidate).find(c => c.status === 'OPEN' || c.status === 'ACTION_PREPARED') ?? null;
  }
  async create(candidate: RecoveryCandidate): Promise<RecoveryCandidate> {
    await db().collection('recoveryCandidates').doc(candidate.id).create(candidate); return candidate;
  }
  async update(candidate: RecoveryCandidate): Promise<RecoveryCandidate> {
    await db().collection('recoveryCandidates').doc(candidate.id).set(candidate,{merge:false}); return candidate;
  }
}

export class FirestoreRecoveryActionRepository implements RecoveryActionRepository {
  async listByCandidate(tenantId: string, candidateId: string): Promise<RecoveryAction[]> {
    const s = await db().collection('recoveryActions').where('tenantId','==',tenantId).where('candidateId','==',candidateId).get();
    return s.docs.map(d => d.data() as RecoveryAction);
  }
  async create(action: RecoveryAction): Promise<RecoveryAction> {
    await db().collection('recoveryActions').doc(action.id).create(action); return action;
  }
}
