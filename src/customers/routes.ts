import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { CustomerMemoryRepository, CustomerRepository } from './contracts';
import { FirestoreCustomerMemoryRepository, FirestoreCustomerRepository } from './firestoreRepository';
import { CustomerService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) {
    throw new ApplicationError({
      category: 'FORBIDDEN',
      code: 'TENANT_CONTEXT_REQUIRED',
      message: 'Tenant context is required.',
    });
  }
  return req.tenantContext;
}

export function createCustomersRouter(
  customers: CustomerRepository = new FirestoreCustomerRepository(),
  memories: CustomerMemoryRepository = new FirestoreCustomerMemoryRepository(),
): Router {
  const router = Router();
  const service = new CustomerService(customers, memories);

  router.get('/', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.list(requireContext(req)) });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.get(requireContext(req), req.params.id) });
    } catch (error) { next(error); }
  });

  router.post('/', async (req: Request, res: Response, next) => {
    try {
      res.status(201).json({ ok: true, data: await service.create(requireContext(req), req.body ?? {}) });
    } catch (error) { next(error); }
  });

  router.patch('/:id', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.update(requireContext(req), req.params.id, req.body ?? {}) });
    } catch (error) { next(error); }
  });

  router.get('/:id/memory', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.getMemory(requireContext(req), req.params.id) });
    } catch (error) { next(error); }
  });

  router.patch('/:id/memory', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.updateMemory(requireContext(req), req.params.id, req.body ?? {}) });
    } catch (error) { next(error); }
  });

  return router;
}
