import { NextFunction, Request, Response } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { TenantContext } from '../types/contracts';
import { createTenantContext } from './context';
import { TenantMembershipRepository } from './contracts';
import { FirestoreTenantMembershipRepository } from './firebaseMembershipRepository';

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

export function createTenantAuthorizationMiddleware(repository: TenantMembershipRepository) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const principal = req.authPrincipal;
      if (!principal?.authUserId) {
        throw new ApplicationError({
          category: 'AUTH',
          code: 'AUTHENTICATED_PRINCIPAL_REQUIRED',
          message: 'Authentication required.',
        });
      }

      const requestedTenantId = typeof req.headers['x-tenant-id'] === 'string'
        ? req.headers['x-tenant-id'].trim()
        : '';
      if (!requestedTenantId) {
        throw new ApplicationError({
          category: 'VALIDATION',
          code: 'TENANT_ID_REQUIRED',
          message: 'Tenant selection is required.',
        });
      }

      const membership = await repository.findActiveMembership(principal.authUserId, requestedTenantId);
      if (!membership) {
        throw new ApplicationError({
          category: 'FORBIDDEN',
          code: 'TENANT_ACCESS_DENIED',
          message: 'Access to the requested tenant is not allowed.',
        });
      }

      const requestId = typeof req.headers['x-request-id'] === 'string'
        ? req.headers['x-request-id'].trim()
        : undefined;
      const correlationId = typeof req.headers['x-correlation-id'] === 'string'
        ? req.headers['x-correlation-id'].trim()
        : undefined;

      req.tenantContext = createTenantContext({
        tenantId: membership.tenantId,
        userId: membership.userId,
        role: membership.role,
        requestId,
        correlationId,
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}

let defaultRepository: TenantMembershipRepository | undefined;

export function tenantAuthorizationMiddleware(req: Request, res: Response, next: NextFunction): void {
  defaultRepository ??= new FirestoreTenantMembershipRepository();
  void createTenantAuthorizationMiddleware(defaultRepository)(req, res, next);
}
