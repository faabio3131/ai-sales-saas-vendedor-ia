import { Request, Response, NextFunction } from 'express';
import { TenantContext } from '../../types/contracts';

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

/**
 * TenantContext Boundary Middleware.
 * Extracts tenant context headers when provided to prepare boundaries for BLK-020/BLK-030.
 * Does NOT enforce authentication or database isolation prematurely.
 */
export function tenantContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const tenantId = (req.headers['x-tenant-id'] as string) || '';
  const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const correlationId = req.headers['x-correlation-id'] as string | undefined;

  if (tenantId) {
    req.tenantContext = {
      tenantId,
      requestId,
      correlationId,
    };
  }

  next();
}
