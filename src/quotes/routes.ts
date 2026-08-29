import { Request, Response, Router } from 'express';
import { FirestoreCatalogRepository } from '../catalog/firestoreRepository';
import { FirestoreCustomerRepository } from '../customers/firestoreRepository';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreOpportunityRepository } from '../leads/firestoreRepository';
import { FirestoreQuoteItemRepository, FirestoreQuoteRepository } from './firestoreRepository';
import { QuoteService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return req.tenantContext;
}

export function createQuotesRouter(): Router {
  const router = Router();
  const service = new QuoteService(
    new FirestoreQuoteRepository(),
    new FirestoreQuoteItemRepository(),
    new FirestoreCatalogRepository(),
    new FirestoreCustomerRepository(),
    new FirestoreOpportunityRepository(),
  );

  router.get('/', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.list(requireContext(req)) }); } catch (error) { next(error); }
  });

  router.get('/:id', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.get(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });

  router.post('/', async (req: Request, res: Response, next) => {
    try { res.status(201).json({ ok: true, data: await service.create(requireContext(req), req.body ?? {}) }); } catch (error) { next(error); }
  });

  router.post('/:id/send', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.send(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });

  router.post('/:id/accept', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok: true, data: await service.accept(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });

  return router;
}
