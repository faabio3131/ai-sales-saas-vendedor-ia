import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ApplicationError } from '../infrastructure/errors';
import { TenantMembership, TenantMembershipRepository } from './contracts';

function ensureFirebaseApp() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
}

export class FirestoreTenantMembershipRepository implements TenantMembershipRepository {
  async findActiveMembership(authUserId: string, tenantId: string): Promise<TenantMembership | null> {
    try {
      ensureFirebaseApp();
      const snapshot = await getFirestore()
        .collection('users')
        .where('authUserId', '==', authUserId)
        .where('tenantId', '==', tenantId)
        .where('status', '==', 'ACTIVE')
        .limit(1)
        .get();

      if (snapshot.empty) return null;

      const document = snapshot.docs[0];
      const data = document.data();
      const role = typeof data.role === 'string' ? data.role.trim() : '';
      if (!role) return null;

      return {
        tenantId,
        authUserId,
        userId: document.id,
        role,
        status: 'ACTIVE',
      };
    } catch {
      throw new ApplicationError({
        category: 'INTERNAL',
        code: 'TENANT_MEMBERSHIP_UNAVAILABLE',
        message: 'Tenant authorization service is unavailable.',
        statusCode: 503,
        retryable: true,
      });
    }
  }
}
