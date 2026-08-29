import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ApplicationError } from '../../infrastructure/errors';

type Bucket = { count: number; resetAt: number };

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].trim() : '';
  const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  req.headers['x-request-id'] = requestId;
  next();
}

export function createRateLimiter(options: { windowMs?: number; max?: number; now?: () => number } = {}) {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 120;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction) => {
    const time = now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || time >= bucket.resetAt) {
      bucket = { count: 0, resetAt: time + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      return next(new ApplicationError({ category: 'RATE_LIMIT', code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.', retryable: true }));
    }
    next();
  };
}
