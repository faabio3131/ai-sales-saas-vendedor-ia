import { Request, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { evaluateCommercialReleaseReadiness } from './readiness';

function requireTenant(req: Request): string {
  const tenantId = req.tenantContext?.tenantId?.trim();
  if (!tenantId) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return tenantId;
}

export function createReleaseRouter(): Router {
  const router = Router();
  router.get('/readiness', (req, res, next) => {
    try {
      res.status(200).json({ ok: true, data: evaluateCommercialReleaseReadiness(requireTenant(req)) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
