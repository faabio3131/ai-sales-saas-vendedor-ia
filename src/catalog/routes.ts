import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { CatalogRepository } from './contracts';
import { FirestoreCatalogRepository } from './firestoreRepository';
import { CatalogService } from './service';

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

export function createCatalogRouter(repository: CatalogRepository = new FirestoreCatalogRepository()): Router {
  const router = Router();
  const service = new CatalogService(repository);

  router.get('/', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.list(requireContext(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', async (req: Request, res: Response, next) => {
    try {
      res.status(200).json({ ok: true, data: await service.get(requireContext(req), req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req: Request, res: Response, next) => {
    try {
      const data = await service.create(requireContext(req), req.body ?? {});
      res.status(201).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id', async (req: Request, res: Response, next) => {
    try {
      const data = await service.update(requireContext(req), req.params.id, req.body ?? {});
      res.status(200).json({ ok: true, data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
