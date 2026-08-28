import { Request, Response, NextFunction } from 'express';
import { ApplicationError } from '../../infrastructure/errors';

/**
 * Standard Express Error Handler Middleware.
 * Intercepts errors and returns standardized JSON matching technical contracts.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApplicationError) {
    res.status(err.statusCode).json({
      ok: false,
      error: {
        category: err.category,
        code: err.code,
        message: err.message,
        retryable: err.retryable,
      },
    });
    return;
  }

  // Unknown/unhandled exceptions are always sanitized at the HTTP boundary.
  // Raw exception details may be handled by future server-side observability,
  // but they must never be returned to clients.
  res.status(500).json({
    ok: false,
    error: {
      category: 'INTERNAL',
      code: 'UNHANDLED_EXCEPTION',
      message: 'Internal server error',
      retryable: false,
    },
  });
}
