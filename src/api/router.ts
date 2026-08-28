import { Router } from 'express';
import { healthCheckHandler } from './routes/health';
import { tenantContextMiddleware } from './middleware/tenantContext';

export function createApiRouter(): Router {
  const router = Router();

  // Apply base context middleware
  router.use(tenantContextMiddleware);

  // Health endpoint
  router.get('/health', healthCheckHandler);

  return router;
}
