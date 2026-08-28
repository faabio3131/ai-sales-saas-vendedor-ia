import { Request, Router } from 'express';
import { FirestoreFollowUpRepository } from '../followups/firestoreRepository';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreLeadRepository, FirestoreOpportunityRepository } from '../leads/firestoreRepository';
import { FirestoreRecoveryCandidateRepository } from '../recovery/firestoreRepository';
import { DashboardService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) {
    throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  }
  return req.tenantContext;
}

export function createDashboardRouter(service = new DashboardService(
  new FirestoreLeadRepository(),
  new FirestoreOpportunityRepository(),
  new FirestoreFollowUpRepository(),
  new FirestoreRecoveryCandidateRepository(),
)): Router {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const snapshot = await service.snapshot(requireContext(req));
      res.status(200).json({ ok: true, data: snapshot });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
