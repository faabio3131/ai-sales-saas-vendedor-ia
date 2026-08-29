import { Request, Response, NextFunction } from 'express';
import { ApplicationError } from '../../infrastructure/errors';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApplicationError) {
    res.status(err.statusCode).json({ ok:false, error:{ category:err.category, code:err.code, message:err.message, retryable:err.retryable } });
    return;
  }

  const candidate = err as { type?: unknown; status?: unknown } | null;
  if (candidate && (candidate.type === 'entity.too.large' || candidate.status === 413)) {
    res.status(413).json({ ok:false, error:{ category:'VALIDATION', code:'PAYLOAD_TOO_LARGE', message:'Request payload is too large.', retryable:false } });
    return;
  }

  res.status(500).json({ ok:false, error:{ category:'INTERNAL', code:'UNHANDLED_EXCEPTION', message:'Internal server error', retryable:false } });
}
