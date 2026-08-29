import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { RevenueExpansionRepository } from './contracts';
import { RevenueExpansion } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreRevenueExpansionRepository implements RevenueExpansionRepository {
  async listByTenant(tenantId: string): Promise<RevenueExpansion[]> {
    const snapshot = await db().collection('revenueExpansions').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as RevenueExpansion).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async findById(tenantId: string, id: string): Promise<RevenueExpansion | null> {
    const doc = await db().collection('revenueExpansions').doc(id).get();
    if (!doc.exists) return null;
    const value = doc.data() as RevenueExpansion;
    return value.tenantId === tenantId ? value : null;
  }
  async findByPaymentId(tenantId: string, paymentId: string): Promise<RevenueExpansion | null> {
    const snapshot = await db().collection('revenueExpansions').where('tenantId', '==', tenantId).where('attributedPaymentId', '==', paymentId).limit(1).get();
    return snapshot.empty ? null : snapshot.docs[0].data() as RevenueExpansion;
  }
  async create(expansion: RevenueExpansion): Promise<RevenueExpansion> {
    await db().collection('revenueExpansions').doc(expansion.id).create(expansion);
    return expansion;
  }
  async update(expansion: RevenueExpansion): Promise<RevenueExpansion> {
    await db().collection('revenueExpansions').doc(expansion.id).set(expansion, { merge: false });
    return expansion;
  }
}
