import { Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApplicationError } from '../infrastructure/errors';
import { ensureFirebaseAdminApp, getFirebaseProjectId } from '../infrastructure/firebaseAdmin';

interface MembershipDiagnosticItem {
  tenantId: string;
  status: string;
  role: string;
}

export async function tenancyMembershipDiagnosticHandler(req: Request, res: Response): Promise<void> {
  const principal = req.authPrincipal;
  if (!principal?.authUserId) {
    throw new ApplicationError({
      category: 'AUTH',
      code: 'AUTHENTICATED_PRINCIPAL_REQUIRED',
      message: 'Authentication required.',
    });
  }

  try {
    const app = ensureFirebaseAdminApp();
    const snapshot = await getFirestore(app)
      .collection('users')
      .where('authUserId', '==', principal.authUserId)
      .limit(25)
      .get();

    const memberships: MembershipDiagnosticItem[] = snapshot.docs.map((document) => {
      const data = document.data();
      return {
        tenantId: typeof data.tenantId === 'string' ? data.tenantId.trim() : '',
        status: typeof data.status === 'string' ? data.status.trim() : '',
        role: typeof data.role === 'string' ? data.role.trim() : '',
      };
    });

    res.status(200).json({
      ok: true,
      data: {
        projectId: getFirebaseProjectId() ?? null,
        collection: 'users',
        membershipCount: memberships.length,
        memberships,
        secretsExposed: false,
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError({
      category: 'INTERNAL',
      code: 'TENANCY_DIAGNOSTIC_UNAVAILABLE',
      message: 'Tenant diagnostic service is unavailable.',
      statusCode: 503,
      retryable: true,
    });
  }
}
