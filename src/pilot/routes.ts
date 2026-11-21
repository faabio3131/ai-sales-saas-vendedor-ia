import { Request, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { evaluatePilotReadiness } from './readiness';
import { createPilotOnboardingRouter } from './onboarding/routes';

function requireTenant(req: Request): string {
  const tenantId = req.tenantContext?.tenantId?.trim();
  if (!tenantId) {
    throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  }
  return tenantId;
}

export function createPilotRouter(): Router {
  const router = Router();
  router.use(createPilotOnboardingRouter());
  router.get('/readiness', (req, res, next) => {
    try {
      res.status(200).json({ ok: true, data: evaluatePilotReadiness(requireTenant(req)) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
