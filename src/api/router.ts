import { Router } from 'express';
import { authenticationMiddleware } from '../auth/middleware';
import { createAuthRouter } from '../auth/routes';
import { createCatalogRouter } from '../catalog/routes';
import { createChannelsRouter } from '../channels/routes';
import { createConversationRouter } from '../conversations/routes';
import { createCustomersRouter } from '../customers/routes';
import { createFollowUpsRouter } from '../followups/routes';
import { createLeadsRouter } from '../leads/routes';
import { createRecoveryRouter } from '../recovery/routes';
import { createSalesRouter } from '../sales/routes';
import { tenantAuthorizationMiddleware } from '../tenancy/middleware';
import { createTenancyRouter } from '../tenancy/routes';
import { healthCheckHandler } from './routes/health';

export function createApiRouter(): Router {
  const router = Router();

  router.use('/auth', createAuthRouter());
  router.get('/health', healthCheckHandler);

  router.use('/tenancy', authenticationMiddleware, tenantAuthorizationMiddleware, createTenancyRouter());
  router.use('/catalog', authenticationMiddleware, tenantAuthorizationMiddleware, createCatalogRouter());
  router.use('/customers', authenticationMiddleware, tenantAuthorizationMiddleware, createCustomersRouter());
  router.use('/conversations', authenticationMiddleware, tenantAuthorizationMiddleware, createConversationRouter());
  router.use('/leads', authenticationMiddleware, tenantAuthorizationMiddleware, createLeadsRouter());
  router.use('/sales', authenticationMiddleware, tenantAuthorizationMiddleware, createSalesRouter());
  router.use('/followups', authenticationMiddleware, tenantAuthorizationMiddleware, createFollowUpsRouter());
  router.use('/recovery', authenticationMiddleware, tenantAuthorizationMiddleware, createRecoveryRouter());
  router.use('/channels', authenticationMiddleware, tenantAuthorizationMiddleware, createChannelsRouter());

  return router;
}
