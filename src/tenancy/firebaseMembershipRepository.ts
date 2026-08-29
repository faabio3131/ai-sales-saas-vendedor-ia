import { getFirestore } from 'firebase-admin/firestore';
import { ApplicationError } from '../infrastructure/errors';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { TenantMembership, TenantMembershipRepository } from './contracts';

interface MembershipDocument {
  id: string;
  data: Record<string, unknown>;
}

export function readMembershipStringField(data: Record<string, unknown>, expectedKey: string): string {
  const direct = data[expectedKey];
  if (typeof direct === 'string') return direct.trim();

  const normalizedExpected = expectedKey.trim().toLowerCase();
  for (const [key, value] of Object.entries(data)) {
    if (key.trim().toLowerCase() === normalizedExpected && typeof value === 'string') {
      return value.trim();
    }
  }

  return '';
}

export function selectActiveMembership(
  authUserId: string,
  tenantId: string,
  documents: MembershipDocument[],
): TenantMembership | null {
  for (const document of documents) {
    const data = document.data;
    const storedAuthUserId = readMembershipStringField(data, 'authUserId');
    const storedTenantId = readMembershipStringField(data, 'tenantId');
    const status = readMembershipStringField(data, 'status');
    const role = readMembershipStringField(data, 'role');

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
