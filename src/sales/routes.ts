import { Request, Response, Router } from 'express';
import { FirestoreLeadRepository, FirestoreOpportunityRepository } from '../leads/firestoreRepository';
import { ApplicationError } from '../infrastructure/errors';
import { SalesDecisionService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return req.tenantContext;
}

export function createSalesRouter(): Router {
  const router = Router();
  const service = new SalesDecisionService(new FirestoreLeadRepository(), new FirestoreOpportunityRepository());

  router.post('/decision', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.decide(requireContext(req), req.body ?? {}) });
    } catch (error) { next(error); }
  });

  return router;
}
