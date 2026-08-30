import { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TenantMembership } from '../src/tenancy/contracts';
import { InMemoryTenantMembershipRepository } from '../src/tenancy/repository';
import { createActiveTenantMembershipsHandler } from '../src/tenancy/routes';

function responseDouble() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { response: { status } as unknown as Response, status, json };
}

function requestFor(authUserId?: string): Request {
  return {
    authPrincipal: authUserId ? { authUserId } : undefined,
  } as unknown as Request;
}

describe('OP-030: tenant membership discovery', () => {
  it('returns only active memberships for the authenticated principal', async () => {
    const memberships: TenantMembership[] = [
      { tenantId: 'tenant-a', authUserId: 'auth-1', userId: 'user-a', role: 'OWNER', status: 'ACTIVE' },
      { tenantId: 'tenant-b', authUserId: 'auth-2', userId: 'user-b', role: 'ADMIN', status: 'ACTIVE' },
      { tenantId: 'tenant-c', authUserId: 'auth-1', userId: 'user-c', role: 'VIEWER', status: 'INACTIVE' },
    ];
    const handler = createActiveTenantMembershipsHandler(new InMemoryTenantMembershipRepository(memberships));
    const { response, status, json } = responseDouble();

    await handler(requestFor('auth-1'), response);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      ok: true,
      data: [
        { tenantId: 'tenant-a', userId: 'user-a', role: 'OWNER', status: 'ACTIVE' },
      ],
    });
  });

  it('fails closed when the authenticated user has no active tenant membership', async () => {
    const memberships: TenantMembership[] = [
      { tenantId: 'tenant-a', authUserId: 'auth-1', userId: 'user-a', role: 'OWNER', status: 'INACTIVE' },
    ];
    const handler = createActiveTenantMembershipsHandler(new InMemoryTenantMembershipRepository(memberships));
    const { response } = responseDouble();

    await expect(handler(requestFor('auth-1'), response)).rejects.toMatchObject({
      category: 'FORBIDDEN',
      code: 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED',
      statusCode: 403,
    });
  });

  it('requires an authenticated principal before membership discovery', async () => {
    const handler = createActiveTenantMembershipsHandler(new InMemoryTenantMembershipRepository([]));
    const { response } = responseDouble();

    await expect(handler(requestFor(), response)).rejects.toMatchObject({
      category: 'AUTH',
      code: 'AUTHENTICATED_PRINCIPAL_REQUIRED',
      statusCode: 401,
    });
  });
});
