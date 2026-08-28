import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';

export function tenantContextHandler(req: Request, res: Response): void {
  if (!req.tenantContext) {
    throw new ApplicationError({
      category: 'FORBIDDEN',
      code: 'TENANT_CONTEXT_REQUIRED',
      message: 'Tenant authorization is required.',
    });
  }

  res.status(200).json({
    ok: true,
    data: {
      tenantId: req.tenantContext.tenantId,
      userId: req.tenantContext.userId,
      role: req.tenantContext.role,
      requestId: req.tenantContext.requestId,
      correlationId: req.tenantContext.correlationId,
    },
  });
}

export function createTenancyRouter(): Router {
  const router = Router();
  router.get('/context', tenantContextHandler);
  return router;
}
