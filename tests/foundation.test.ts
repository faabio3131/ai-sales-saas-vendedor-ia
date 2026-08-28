import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, Result, AppErrorCategory } from '../src/types/contracts';
import { loadServerConfig } from '../src/infrastructure/config';
import { 
  ApplicationError, 
  mapCategoryToStatusCode, 
  createSuccessResult, 
  createErrorResult 
} from '../src/infrastructure/errors';
import { isValidTenantContext, createTenantContext } from '../src/tenancy/context';
import { errorHandler } from '../src/api/middleware/errorHandler';
import { healthCheckHandler } from '../src/api/routes/health';

describe('BLK-010: Application Foundation Tests', () => {
  describe('Server Configuration Module', () => {
    it('should parse default configuration safely when no env variables are set', () => {
      const config = loadServerConfig({});
      expect(config.port).toBe(3000);
      expect(config.nodeEnv).toBe('development');
      expect(config.block).toBe('BLK-020');
      expect(config.serviceName).toContain('Vendedor IA');
    });

    it('should respect custom PORT and NODE_ENV when provided', () => {
      const config = loadServerConfig({
        PORT: '3000',
        NODE_ENV: 'production',
      });
      expect(config.port).toBe(3000);
      expect(config.nodeEnv).toBe('production');
    });
  });

  describe('Error Infrastructure & Result Types', () => {
    it('should map AppErrorCategory to appropriate HTTP status codes', () => {
      const categories: Record<AppErrorCategory, number> = {
        VALIDATION: 400,
        AUTH: 401,
        FORBIDDEN: 403,
        NOT_FOUND: 404,
        CONFLICT: 409,
        RATE_LIMIT: 429,
        PROVIDER: 502,
        INTERNAL: 500,
      };

      for (const [cat, expectedCode] of Object.entries(categories)) {
        expect(mapCategoryToStatusCode(cat as AppErrorCategory)).toBe(expectedCode);
      }
    });

    it('should instantiate ApplicationError with correct properties', () => {
      const error = new ApplicationError({
        category: 'VALIDATION',
        code: 'INVALID_INPUT',
        message: 'O campo informado é inválido.',
        retryable: false,
      });

      expect(error.name).toBe('ApplicationError');
      expect(error.category).toBe('VALIDATION');
      expect(error.code).toBe('INVALID_INPUT');
      expect(error.statusCode).toBe(400);
      expect(error.retryable).toBe(false);
    });

    it('should create success and error Result objects adhering to contracts', () => {
      const success: Result<{ id: string }> = createSuccessResult({ id: 'res_123' });
      expect(success.ok).toBe(true);
      expect(success.data?.id).toBe('res_123');
      expect(success.error).toBeUndefined();

      const failure = createErrorResult('NOT_FOUND', 'TENANT_NOT_FOUND', 'Tenant não encontrado');
      expect(failure.ok).toBe(false);
      expect(failure.error?.category).toBe('NOT_FOUND');
      expect(failure.error?.code).toBe('TENANT_NOT_FOUND');
    });

    it('should always sanitize unknown errors at the HTTP boundary', () => {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const res = { status } as unknown as Response;
      const next = vi.fn() as unknown as NextFunction;
      const internalMessage = 'database password leaked here';

      errorHandler(new Error(internalMessage), {} as Request, res, next);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({
        ok: false,
        error: {
          category: 'INTERNAL',
          code: 'UNHANDLED_EXCEPTION',
          message: 'Internal server error',
          retryable: false,
        },
      });
      expect(JSON.stringify(json.mock.calls)).not.toContain(internalMessage);
    });
  });

  describe('Tenancy Context Boundaries', () => {
    it('should correctly validate valid and invalid TenantContext objects', () => {
      const validContext: TenantContext = {
        tenantId: 'tenant-enterprise-01',
        requestId: 'req-98765',
        userId: 'user-admin',
      };

      expect(isValidTenantContext(validContext)).toBe(true);
      expect(isValidTenantContext(null)).toBe(false);
      expect(isValidTenantContext({ tenantId: '' })).toBe(false);
      expect(isValidTenantContext({ tenantId: 'tenant-1', requestId: '' })).toBe(false);
    });

    it('should generate a standard TenantContext via helper', () => {
      const created = createTenantContext({
        tenantId: 'tenant-abc',
        userId: 'user-xyz',
        role: 'OWNER',
        requestId: 'req-custom',
      });

      expect(created.tenantId).toBe('tenant-abc');
      expect(created.userId).toBe('user-xyz');
      expect(created.role).toBe('OWNER');
      expect(created.requestId).toBe('req-custom');
    });

    it('should expose tenant boundary preparation without claiming guaranteed multitenancy', () => {
      const json = vi.fn();
      const status = vi.fn(() => ({ json }));
      const res = { status } as unknown as Response;

      healthCheckHandler({} as Request, res);

      expect(status).toHaveBeenCalledWith(200);
      const payload = json.mock.calls[0][0] as {
        governance: Record<string, unknown>;
      };

      expect(payload.governance.tenantBoundaryPrepared).toBe(true);
      expect(payload.governance).not.toHaveProperty('multitenancyGuaranteed');
    });
  });
});
