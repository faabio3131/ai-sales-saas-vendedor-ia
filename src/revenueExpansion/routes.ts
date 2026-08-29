import { Request, Router } from 'express';
import { FirestoreCatalogRepository } from '../catalog/firestoreRepository';
import { ApplicationError } from '../infrastructure/errors';
import { FirestorePaymentRepository } from '../payments/firestoreRepository';
import { FirestoreRevenueExpansionRepository } from './firestoreRepository';
import { RevenueExpansionService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category:'FORBIDDEN', code:'TENANT_CONTEXT_REQUIRED', message:'Tenant context is required.' });
  return req.tenantContext;
}

export function createRevenueExpansionRouter(): Router {
  const router = Router();
  const service = new RevenueExpansionService(new FirestoreRevenueExpansionRepository(), new FirestoreCatalogRepository(), new FirestorePaymentRepository());
  router.get('/', async (req, res, next) => { try { res.status(200).json({ ok:true, data:await service.list(requireContext(req)) }); } catch (e) { next(e); } });
  router.post('/', async (req, res, next) => { try { res.status(201).json({ ok:true, data:await service.suggest(requireContext(req), req.body ?? {}) }); } catch (e) { next(e); } });
  router.post('/:id/approve', async (req, res, next) => { try { res.status(200).json({ ok:true, data:await service.approve(requireContext(req), req.params.id) }); } catch (e) { next(e); } });
  router.post('/:id/attribute', async (req, res, next) => { try { res.status(200).json({ ok:true, data:await service.attribute(requireContext(req), req.params.id, String(req.body?.paymentId ?? '')) }); } catch (e) { next(e); } });
  return router;
}
