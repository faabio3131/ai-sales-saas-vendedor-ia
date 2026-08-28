import { Router } from 'express';
import { createAuthRouter } from '../auth/routes';
import { healthCheckHandler } from './routes/health';
import { tenantContextMiddleware } from './middleware/tenantContext';

export function createApiRouter(): Router {
  const router = Router();

  // Authentication is identity-scoped only in BLK-020. Tenant authorization begins in BLK-030.
  router.use('/auth', createAuthRouter());

  // Preliminary tenant context boundary; grants no authority until BLK-030.
  router.use(tenantContextMiddleware);

  router.get('/health', healthCheckHandler);

  return router;
}
