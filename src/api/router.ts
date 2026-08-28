import { Router } from 'express';
import { authenticationMiddleware } from '../auth/middleware';
import { createAuthRouter } from '../auth/routes';
import { createCatalogRouter } from '../catalog/routes';
import { createConversationRouter } from '../conversations/routes';
import { createCustomersRouter } from '../customers/routes';
import { tenantAuthorizationMiddleware } from '../tenancy/middleware';
import { createTenancyRouter } from '../tenancy/routes';
import { healthCheckHandler } from './routes/health';

export function createApiRouter(): Router {
  const router = Router();

  // Public identity/session endpoints.
  router.use('/auth', createAuthRouter());

  // Public operational health endpoint.
  router.get('/health', healthCheckHandler);

  // Protected boundaries: authenticated identity + verified tenant membership.
  router.use('/tenancy', authenticationMiddleware, tenantAuthorizationMiddleware, createTenancyRouter());
  router.use('/catalog', authenticationMiddleware, tenantAuthorizationMiddleware, createCatalogRouter());
  router.use('/customers', authenticationMiddleware, tenantAuthorizationMiddleware, createCustomersRouter());
  router.use('/conversations', authenticationMiddleware, tenantAuthorizationMiddleware, createConversationRouter());

  return router;
}
