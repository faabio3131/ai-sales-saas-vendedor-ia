import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreQuoteRepository } from '../quotes/firestoreRepository';
import { FirestorePaymentRepository, FirestorePaymentWebhookEventRepository } from './firestoreRepository';
import { StructuralPaymentProvider } from './provider';
import { PaymentService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category:'FORBIDDEN', code:'TENANT_CONTEXT_REQUIRED', message:'Tenant context is required.' });
  return req.tenantContext;
}

export function createPaymentsRouter(): Router {
  const router = Router();
  const service = new PaymentService(
    new FirestorePaymentRepository(),
    new FirestorePaymentWebhookEventRepository(),
    new FirestoreQuoteRepository(),
    new StructuralPaymentProvider(),
  );

  router.get('/', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await service.list(requireContext(req)) }); } catch (error) { next(error); }
  });
  router.get('/:id', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await service.get(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });
  router.post('/', async (req, res, next) => {
    try { res.status(201).json({ ok:true, data:await service.create(requireContext(req), req.body ?? {}) }); } catch (error) { next(error); }
  });
  router.post('/:id/refresh', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await service.refresh(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });
  router.post('/webhook/provider', async (req: Request, res: Response, next) => {
    try { res.status(200).json({ ok:true, data:await service.handleWebhook(requireContext(req), req.headers, req.body) }); } catch (error) { next(error); }
  });
  return router;
}
