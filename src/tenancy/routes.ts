import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreTenantMembershipRepository } from './firebaseMembershipRepository';

export function tenantContextHandler(req: Request, res: Response): void {
  if (!req.tenantContext) {
    throw new ApplicationError({
      category: 'FORBIDDEN',
      code: 'TENANT_CONTEXT_REQUIRED',
      message: 'Tenant authorization is required.',
    });
  }

  res.status(200).json({
    ok: true,
    data: {
      tenantId: req.tenantContext.tenantId,
      userId: req.tenantContext.userId,
      role: req.tenantContext.role,
      requestId: req.tenantContext.requestId,
      correlationId: req.tenantContext.correlationId,
    },
  });
}

export async function activeTenantMembershipsHandler(req: Request, res: Response): Promise<void> {
  const authUserId = req.authPrincipal?.authUserId?.trim();
  if (!authUserId) {
    throw new ApplicationError({
      category: 'AUTH',
      code: 'AUTHENTICATED_PRINCIPAL_REQUIRED',
      message: 'Authentication required.',
      statusCode: 401,
      retryable: false,
    });
  }

  const memberships = await new FirestoreTenantMembershipRepository().listActiveMemberships(authUserId);
  res.status(200).json({
    ok: true,
    data: memberships.map((membership) => ({
      tenantId: membership.tenantId,
      userId: membership.userId,
      role: membership.role,
      status: membership.status,
    })),
  });
}

export function createTenancyRouter(): Router {
  const router = Router();
  router.get('/context', tenantContextHandler);
  return router;
}
