import { Router } from 'express';
import { FirestoreFollowUpRepository } from '../followups/firestoreRepository';
import { FirestoreLeadRepository, FirestoreOpportunityRepository } from '../leads/firestoreRepository';
import { FirestoreRecoveryCandidateRepository } from '../recovery/firestoreRepository';
import { requireTenantContext } from '../tenancy/context';
import { DashboardService } from './service';

export function createDashboardRouter(service = new DashboardService(
  new FirestoreLeadRepository(),
  new FirestoreOpportunityRepository(),
  new FirestoreFollowUpRepository(),
  new FirestoreRecoveryCandidateRepository(),
)): Router {
  const router = Router();
  router.get('/', async (req, res, next) => {
    try {
      const snapshot = await service.snapshot(requireTenantContext(req));
      res.json({ ok: true, data: snapshot });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
