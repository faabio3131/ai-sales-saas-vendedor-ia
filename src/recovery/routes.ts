import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreOpportunityRepository } from '../leads/firestoreRepository';
import { FirestoreRecoveryActionRepository, FirestoreRecoveryCandidateRepository } from './firestoreRepository';
import { RecoveryService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return req.tenantContext;
}

export function createRecoveryRouter(): Router {
  const router = Router();
  const service = new RecoveryService(
    new FirestoreOpportunityRepository(),
    new FirestoreRecoveryCandidateRepository(),
    new FirestoreRecoveryActionRepository(),
  );

  router.get('/', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.list(requireContext(req)) }); } catch (error) { next(error); }
  });
  router.post('/detect', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.detect(requireContext(req)) }); } catch (error) { next(error); }
  });
  router.post('/:id/actions', async (req: Request, res: Response, next) => {
    try { res.status(201).json({ ok: true, data: await service.prepareAction(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });
  return router;
}
