import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FollowUpRepository } from './contracts';
import { FollowUp } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreFollowUpRepository implements FollowUpRepository {
  async listByTenant(tenantId: string): Promise<FollowUp[]> {
    const snapshot = await db().collection('followUps').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as FollowUp).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  async findById(tenantId: string, id: string): Promise<FollowUp | null> {
    const doc = await db().collection('followUps').doc(id).get();
    if (!doc.exists) return null;
    const item = doc.data() as FollowUp;
    return item.tenantId === tenantId ? item : null;
  }

  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<FollowUp | null> {
    const snapshot = await db().collection('followUps')
      .where('tenantId', '==', tenantId)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0].data() as FollowUp;
  }

  async listDue(tenantId: string, dueBefore: string): Promise<FollowUp[]> {
    const snapshot = await db().collection('followUps')
      .where('tenantId', '==', tenantId)
      .where('scheduledAt', '<=', dueBefore)
      .get();
    return snapshot.docs
      .map((doc) => doc.data() as FollowUp)
      .filter((item) => item.status === 'SCHEDULED' || item.status === 'RETRY')
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  }

  async create(followUp: FollowUp): Promise<FollowUp> {
    await db().collection('followUps').doc(followUp.id).create(followUp);
    return followUp;
  }

  async update(followUp: FollowUp): Promise<FollowUp> {
    await db().collection('followUps').doc(followUp.id).set(followUp, { merge: false });
    return followUp;
  }
}
