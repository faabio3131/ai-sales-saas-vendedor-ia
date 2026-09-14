import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SalesFiscalHandoffRepository } from './contracts';
import { SalesFiscalHandoff } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreSalesFiscalHandoffRepository implements SalesFiscalHandoffRepository {
  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<SalesFiscalHandoff | null> {
    const snapshot = await db()
      .collection('salesFiscalHandoffs')
      .where('tenantId', '==', tenantId)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0].data() as SalesFiscalHandoff;
  }

  async create(handoff: SalesFiscalHandoff): Promise<SalesFiscalHandoff> {
    await db().collection('salesFiscalHandoffs').doc(handoff.id).create(handoff);
    return handoff;
  }
}
