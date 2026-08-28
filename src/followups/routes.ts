import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { FollowUpRepository } from './contracts';
import { FirestoreFollowUpRepository } from './firestoreRepository';
import { FollowUpService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return req.tenantContext;
}

export function createFollowUpsRouter(repository: FollowUpRepository = new FirestoreFollowUpRepository()): Router {
  const router = Router();
  const service = new FollowUpService(repository);

  router.get('/', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.list(requireContext(req)) }); }
    catch (error) { next(error); }
  });

  router.get('/due', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.listDue(requireContext(req), typeof req.query.before === 'string' ? req.query.before : undefined) }); }
    catch (error) { next(error); }
  });

  router.get('/:id', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.get(requireContext(req), req.params.id) }); }
    catch (error) { next(error); }
  });

  router.post('/', async (req: Request, res: Response, next) => {
    try { res.status(201).json({ ok: true, data: await service.create(requireContext(req), req.body ?? {}) }); }
    catch (error) { next(error); }
  });

  router.post('/:id/execute', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.execute(requireContext(req), req.params.id, req.body ?? {}) }); }
    catch (error) { next(error); }
  });

  router.post('/:id/cancel', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.cancel(requireContext(req), req.params.id) }); }
    catch (error) { next(error); }
  });

  return router;
}
