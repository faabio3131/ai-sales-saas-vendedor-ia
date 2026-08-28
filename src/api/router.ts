import { Router } from 'express';
import { authenticationMiddleware } from '../auth/middleware';
import { createAuthRouter } from '../auth/routes';
import { tenantAuthorizationMiddleware } from '../tenancy/middleware';
import { createTenancyRouter } from '../tenancy/routes';
import { healthCheckHandler } from './routes/health';

export function createApiRouter(): Router {
  const router = Router();

  // Public identity/session endpoints.
  router.use('/auth', createAuthRouter());

  // Public operational health endpoint.
  router.get('/health', healthCheckHandler);

  // BLK-030 protected boundary: authenticated identity + verified tenant membership.
  router.use('/tenancy', authenticationMiddleware, tenantAuthorizationMiddleware, createTenancyRouter());

  return router;
}
