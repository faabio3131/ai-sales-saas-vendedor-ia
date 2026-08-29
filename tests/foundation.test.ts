import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { TenantContext, Result, AppErrorCategory } from '../src/types/contracts';
import { loadServerConfig } from '../src/infrastructure/config';
import { ApplicationError, mapCategoryToStatusCode, createSuccessResult, createErrorResult } from '../src/infrastructure/errors';
import { isValidTenantContext, createTenantContext } from '../src/tenancy/context';
import { errorHandler } from '../src/api/middleware/errorHandler';
import { healthCheckHandler } from '../src/api/routes/health';
describe('Application Foundation regression tests', () => {
 it('parses safe default server configuration',()=>{const c=loadServerConfig({});expect(c.port).toBe(3000);expect(c.nodeEnv).toBe('development');expect(c.block).toBe('BLK-200');expect(c.serviceName).toContain('Vendedor IA');});
 it('respects supported runtime configuration',()=>{const c=loadServerConfig({PORT:'3000',NODE_ENV:'production'});expect(c.port).toBe(3000);expect(c.nodeEnv).toBe('production');});
 it('maps application error categories to HTTP status codes',()=>{const categories:Record<AppErrorCategory,number>={VALIDATION:400,AUTH:401,FORBIDDEN:403,NOT_FOUND:404,CONFLICT:409,RATE_LIMIT:429,PROVIDER:502,INTERNAL:500};for(const [k,v] of Object.entries(categories))expect(mapCategoryToStatusCode(k as AppErrorCategory)).toBe(v);});
 it('instantiates ApplicationError with the normalized contract',()=>{const e=new ApplicationError({category:'VALIDATION',code:'INVALID_INPUT',message:'Invalid input.',retryable:false});expect(e.name).toBe('ApplicationError');expect(e.category).toBe('VALIDATION');expect(e.code).toBe('INVALID_INPUT');expect(e.statusCode).toBe(400);expect(e.retryable).toBe(false);});
 it('creates success and error Result objects',()=>{const s:Result<{id:string}>=createSuccessResult({id:'res_123'});expect(s.ok).toBe(true);expect(s.data?.id).toBe('res_123');const f=createErrorResult('NOT_FOUND','TENANT_NOT_FOUND','Tenant not found');expect(f.ok).toBe(false);expect(f.error?.category).toBe('NOT_FOUND');});
 it('sanitizes unknown errors at the HTTP boundary',()=>{const json=vi.fn();const status=vi.fn(()=>({json}));errorHandler(new Error('private internal detail'),{} as Request,{status} as unknown as Response,vi.fn() as unknown as NextFunction);expect(status).toHaveBeenCalledWith(500);expect(JSON.stringify(json.mock.calls)).not.toContain('private internal detail');});
 it('validates tenant context boundaries',()=>{const valid:TenantContext={tenantId:'tenant-1',requestId:'req-1',userId:'user-1'};expect(isValidTenantContext(valid)).toBe(true);expect(isValidTenantContext(null)).toBe(false);expect(isValidTenantContext({tenantId:''})).toBe(false);});
 it('creates a normalized tenant context',()=>{expect(createTenantContext({tenantId:'tenant-a',userId:'user-a',role:'OWNER',requestId:'req-a'})).toMatchObject({tenantId:'tenant-a',userId:'user-a'});});
 it('reports enforced tenant isolation without obsolete claims',()=>{const json=vi.fn();const status=vi.fn(()=>({json}));healthCheckHandler({} as Request,{status} as unknown as Response);const p=json.mock.calls[0][0] as {governance:Record<string,unknown>};expect(p.governance.tenantIsolationEnforced).toBe(true);expect(p.governance).not.toHaveProperty('multitenancyGuaranteed');});
});
