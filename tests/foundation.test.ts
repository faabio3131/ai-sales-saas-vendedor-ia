import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, Result, AppErrorCategory } from '../src/types/contracts';
import { loadServerConfig } from '../src/infrastructure/config';
import { ApplicationError, mapCategoryToStatusCode, createSuccessResult, createErrorResult } from '../src/infrastructure/errors';
import { isValidTenantContext, createTenantContext } from '../src/tenancy/context';
import { errorHandler } from '../src/api/middleware/errorHandler';
import { healthCheckHandler } from '../src/api/routes/health';

describe('Application Foundation regression tests', () => {
  it('parses safe default server configuration', () => {
    const config = loadServerConfig({});
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.block).toBe('BLK-130');
    expect(config.serviceName).toContain('Vendedor IA');
  });

  it('respects supported runtime configuration', () => {
    const config = loadServerConfig({ PORT: '3000', NODE_ENV: 'production' });
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('production');
  });

  it('maps application error categories to HTTP status codes', () => {
    const categories: Record<AppErrorCategory, number> = {
      VALIDATION: 400, AUTH: 401, FORBIDDEN: 403, NOT_FOUND: 404,
      CONFLICT: 409, RATE_LIMIT: 429, PROVIDER: 502, INTERNAL: 500,
    };
    for (const [category, expected] of Object.entries(categories)) {
      expect(mapCategoryToStatusCode(category as AppErrorCategory)).toBe(expected);
    }
  });

  it('instantiates ApplicationError with the normalized contract', () => {
    const error = new ApplicationError({ category: 'VALIDATION', code: 'INVALID_INPUT', message: 'Invalid input.', retryable: false });
    expect(error.name).toBe('ApplicationError');
    expect(error.category).toBe('VALIDATION');
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.statusCode).toBe(400);
    expect(error.retryable).toBe(false);
  });

  it('creates success and error Result objects', () => {
    const success: Result<{ id: string }> = createSuccessResult({ id: 'res_123' });
    expect(success.ok).toBe(true);
    expect(success.data?.id).toBe('res_123');
    const failure = createErrorResult('NOT_FOUND', 'TENANT_NOT_FOUND', 'Tenant not found');
    expect(failure.ok).toBe(false);
    expect(failure.error?.category).toBe('NOT_FOUND');
  });

  it('sanitizes unknown errors at the HTTP boundary', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res = { status } as unknown as Response;
    errorHandler(new Error('private internal detail'), {} as Request, res, vi.fn() as unknown as NextFunction);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ ok: false, error: { category: 'INTERNAL', code: 'UNHANDLED_EXCEPTION', message: 'Internal server error', retryable: false } });
    expect(JSON.stringify(json.mock.calls)).not.toContain('private internal detail');
  });

  it('validates tenant context boundaries', () => {
    const valid: TenantContext = { tenantId: 'tenant-1', requestId: 'req-1', userId: 'user-1' };
    expect(isValidTenantContext(valid)).toBe(true);
    expect(isValidTenantContext(null)).toBe(false);
    expect(isValidTenantContext({ tenantId: '' })).toBe(false);
    expect(isValidTenantContext({ tenantId: 'tenant-1', requestId: '' })).toBe(false);
  });

  it('creates a normalized tenant context', () => {
    const created = createTenantContext({ tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER', requestId: 'req-a' });
    expect(created).toMatchObject({ tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER', requestId: 'req-a' });
  });

  it('reports enforced tenant isolation without obsolete claims', () => {
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    healthCheckHandler({} as Request, { status } as unknown as Response);
    const payload = json.mock.calls[0][0] as { governance: Record<string, unknown> };
    expect(payload.governance.tenantBoundaryPrepared).toBe(true);
    expect(payload.governance.tenantIsolationEnforced).toBe(true);
    expect(payload.governance).not.toHaveProperty('multitenancyGuaranteed');
  });
});
