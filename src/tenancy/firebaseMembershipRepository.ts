import { getFirestore } from 'firebase-admin/firestore';
import { ApplicationError } from '../infrastructure/errors';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { TenantMembership, TenantMembershipRepository } from './contracts';

export class FirestoreTenantMembershipRepository implements TenantMembershipRepository {
  async findActiveMembership(authUserId: string, tenantId: string): Promise<TenantMembership | null> {
    try {
      const app = ensureFirebaseAdminApp();
      const snapshot = await getFirestore(app)
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
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'FIREBASE_NOT_CONFIGURED') throw error;
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
