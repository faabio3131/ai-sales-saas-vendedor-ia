import { getFirestore } from 'firebase-admin/firestore';
import { ApplicationError } from '../infrastructure/errors';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { TenantMembership, TenantMembershipRepository } from './contracts';

interface MembershipDocument {
  id: string;
  data: Record<string, unknown>;
}

export function selectActiveMembership(
  authUserId: string,
  tenantId: string,
  documents: MembershipDocument[],
): TenantMembership | null {
  for (const document of documents) {
    const data = document.data;
    const storedAuthUserId = typeof data.authUserId === 'string' ? data.authUserId.trim() : '';
    const storedTenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
    const status = typeof data.status === 'string' ? data.status.trim() : '';
    const role = typeof data.role === 'string' ? data.role.trim() : '';

    if (
      storedAuthUserId === authUserId &&
      storedTenantId === tenantId &&
      status === 'ACTIVE' &&
      role
    ) {
      return {
        tenantId: storedTenantId,
        authUserId: storedAuthUserId,
        userId: document.id,
        role,
        status: 'ACTIVE',
      };
    }
  }

  return null;
}

export class FirestoreTenantMembershipRepository implements TenantMembershipRepository {
  async findActiveMembership(authUserId: string, tenantId: string): Promise<TenantMembership | null> {
    try {
      const app = ensureFirebaseAdminApp();
      const snapshot = await getFirestore(app)
        .collection('users')
        .where('authUserId', '==', authUserId)
        .limit(25)
        .get();

      if (snapshot.empty) {
        throw new ApplicationError({
          category: 'FORBIDDEN',
          code: 'TENANT_PRINCIPAL_MEMBERSHIP_NOT_FOUND',
          message: 'No tenant membership is registered for the authenticated principal.',
          statusCode: 403,
          retryable: false,
        });
      }

      return selectActiveMembership(
        authUserId,
        tenantId,
        snapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
      );
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
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
