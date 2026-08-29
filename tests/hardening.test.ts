import { describe, expect, it, vi } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import { createRateLimiter, requestContext, securityHeaders } from '../src/api/middleware/hardening';

function responseMock() {
  const headers = new Map<string, string>();
  return {
    headers,
    response: { setHeader: (k:string,v:string)=>headers.set(k,v) } as unknown as Response,
  };
}

describe('BLK-180 Hardening', () => {
  it('applies security headers', () => {
    const { headers, response } = responseMock();
    const next = vi.fn();
    securityHeaders({} as Request, response, next as unknown as NextFunction);
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(next).toHaveBeenCalledOnce();
  });

  it('preserves valid request id and generates one when absent', () => {
    const first = responseMock();
    const req1 = { headers:{'x-request-id':'req-123'} } as unknown as Request;
    requestContext(req1, first.response, vi.fn() as unknown as NextFunction);
    expect(first.headers.get('X-Request-Id')).toBe('req-123');
    const second = responseMock();
    const req2 = { headers:{} } as unknown as Request;
    requestContext(req2, second.response, vi.fn() as unknown as NextFunction);
    expect(second.headers.get('X-Request-Id')).toBeTruthy();
  });

  it('rate limits repeated requests inside the same window', () => {
    let clock = 1000;
    const limiter = createRateLimiter({ max:2, windowMs:1000, now:()=>clock });
    const req = { ip:'127.0.0.1', socket:{} } as unknown as Request;
    const first = responseMock(); const n1=vi.fn(); limiter(req, first.response, n1 as unknown as NextFunction); expect(n1.mock.calls[0][0]).toBeUndefined();
    const second = responseMock(); const n2=vi.fn(); limiter(req, second.response, n2 as unknown as NextFunction); expect(n2.mock.calls[0][0]).toBeUndefined();
    const third = responseMock(); const n3=vi.fn(); limiter(req, third.response, n3 as unknown as NextFunction); expect(n3.mock.calls[0][0]).toMatchObject({ code:'RATE_LIMIT_EXCEEDED' });
    clock = 2000;
    const fourth = responseMock(); const n4=vi.fn(); limiter(req, fourth.response, n4 as unknown as NextFunction); expect(n4.mock.calls[0][0]).toBeUndefined();
  });
});
