import { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ApplicationError } from '../src/infrastructure/errors';
import { createTenantAuthorizationMiddleware } from '../src/tenancy/middleware';
import { InMemoryTenantMembershipRepository } from '../src/tenancy/repository';
import { TenantMembership } from '../src/tenancy/contracts';

const memberships: TenantMembership[] = [
  {
    tenantId: 'tenant-a',
    authUserId: 'auth-user-1',
    userId: 'user-a-1',
    role: 'OWNER',
    status: 'ACTIVE',
  },
  {
    tenantId: 'tenant-b',
    authUserId: 'auth-user-2',
    userId: 'user-b-1',
    role: 'ADMIN',
    status: 'ACTIVE',
  },
  {
    tenantId: 'tenant-c',
    authUserId: 'auth-user-1',
    userId: 'user-c-1',
    role: 'VIEWER',
    status: 'INACTIVE',
  },
  {
    tenantId: 'tenant-d',
    authUserId: 'auth-user-1',
    userId: 'user-d-1',
    role: '   ',
    status: 'ACTIVE',
  },
];

function requestFor(authUserId: string | undefined, tenantId: string): Request {
  return {
    authPrincipal: authUserId ? { authUserId } : undefined,
    headers: {
      'x-tenant-id': tenantId,
      'x-request-id': 'req-test-1',
      'x-correlation-id': 'corr-test-1',
    },
  } as unknown as Request;
}

describe('BLK-030: Tenancy', () => {
  it('lists only active memberships owned by the authenticated principal', async () => {
    const repository = new InMemoryTenantMembershipRepository(memberships);

    await expect(repository.listActiveMemberships('auth-user-1')).resolves.toEqual([
      {
        tenantId: 'tenant-a',
        authUserId: 'auth-user-1',
        userId: 'user-a-1',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    ]);
  });

  it('creates TenantContext only after verified active membership', async () => {
    const repository = new InMemoryTenantMembershipRepository(memberships);
    const middleware = createTenantAuthorizationMiddleware(repository);
    const req = requestFor('auth-user-1', 'tenant-a');
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.tenantContext).toEqual({
      tenantId: 'tenant-a',
      userId: 'user-a-1',
      role: 'OWNER',
      requestId: 'req-test-1',
      correlationId: 'corr-test-1',
    });
  });

  it('blocks cross-tenant access even when the client spoofs x-tenant-id', async () => {
    const repository = new InMemoryTenantMembershipRepository(memberships);
    const middleware = createTenantAuthorizationMiddleware(repository);
    const req = requestFor('auth-user-1', 'tenant-b');
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, {} as Response, next);

    expect(req.tenantContext).toBeUndefined();
    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ApplicationError;
    expect(error.category).toBe('FORBIDDEN');
    expect(error.code).toBe('TENANT_ACCESS_DENIED');
    expect(error.statusCode).toBe(403);
  });

  it('blocks inactive tenant membership', async () => {
    const repository = new InMemoryTenantMembershipRepository(memberships);
    const middleware = createTenantAuthorizationMiddleware(repository);
    const req = requestFor('auth-user-1', 'tenant-c');
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, {} as Response, next);

    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ApplicationError;
    expect(error.code).toBe('TENANT_ACCESS_DENIED');
  });

  it('rejects tenant resolution without an authenticated principal', async () => {
    const repository = new InMemoryTenantMembershipRepository(memberships);
    const middleware = createTenantAuthorizationMiddleware(repository);
    const req = requestFor(undefined, 'tenant-a');
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, {} as Response, next);

    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ApplicationError;
    expect(error.category).toBe('AUTH');
    expect(error.code).toBe('AUTHENTICATED_PRINCIPAL_REQUIRED');
  });

  it('requires explicit tenant selection instead of guessing a tenant', async () => {
    const repository = new InMemoryTenantMembershipRepository(memberships);
    const middleware = createTenantAuthorizationMiddleware(repository);
    const req = requestFor('auth-user-1', '');
    const next = vi.fn() as unknown as NextFunction;

    await middleware(req, {} as Response, next);

    const error = (next as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as ApplicationError;
    expect(error.category).toBe('VALIDATION');
    expect(error.code).toBe('TENANT_ID_REQUIRED');
  });
});
