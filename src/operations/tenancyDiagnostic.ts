import { Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApplicationError } from '../infrastructure/errors';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';

export async function tenancyDiagnosticHandler(req: Request, res: Response): Promise<void> {
  const authUserId = req.authPrincipal?.authUserId?.trim();
  if (!authUserId) {
    throw new ApplicationError({
      category: 'AUTH',
      code: 'AUTHENTICATED_PRINCIPAL_REQUIRED',
      message: 'Authentication required.',
    });
  }

  const requestedTenantId = typeof req.headers['x-tenant-id'] === 'string'
    ? req.headers['x-tenant-id'].trim()
    : '';

  try {
    const app = ensureFirebaseAdminApp();
    const snapshot = await getFirestore(app)
      .collection('users')
      .where('authUserId', '==', authUserId)
      .limit(25)
      .get();

    let requestedTenantMatch = false;
    let activeMatch = false;
    let rolePresent = false;

    for (const document of snapshot.docs) {
      const data = document.data();
      const tenantId = typeof data.tenantId === 'string' ? data.tenantId.trim() : '';
      if (requestedTenantId && tenantId === requestedTenantId) {
        requestedTenantMatch = true;
        const status = typeof data.status === 'string' ? data.status.trim() : '';
        activeMatch = status === 'ACTIVE';
        const role = typeof data.role === 'string' ? data.role.trim() : '';
        rolePresent = Boolean(role);
        break;
      }
    }

    res.status(200).json({
      ok: true,
      data: {
        principalPresent: true,
        requestedTenantProvided: Boolean(requestedTenantId),
        membershipsForPrincipal: snapshot.size,
        requestedTenantMatch,
        activeMatch,
        rolePresent,
        secretsExposed: false,
      },
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError({
      category: 'INTERNAL',
      code: 'TENANCY_DIAGNOSTIC_UNAVAILABLE',
      message: 'Tenancy diagnostic is unavailable.',
      statusCode: 503,
      retryable: true,
    });
  }
}
