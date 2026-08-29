import { describe, expect, it } from 'vitest';
import { listActiveMembershipsFromDocuments, selectActiveMembership } from '../src/tenancy/firebaseMembershipRepository';

describe('OP-020/OP-030: Firebase tenant membership selection', () => {
  it('finds the requested active tenant and trims stored string values', () => {
    const membership = selectActiveMembership('auth-1', 'tenant-a', [
      {
        id: 'user-doc-1',
        data: {
          authUserId: ' auth-1 ',
          tenantId: ' tenant-a ',
          role: ' OWNER ',
          status: ' ACTIVE ',
        },
      },
    ]);

    expect(membership).toEqual({
      authUserId: 'auth-1',
      tenantId: 'tenant-a',
      userId: 'user-doc-1',
      role: 'OWNER',
      status: 'ACTIVE',
    });
  });

  it('does not authorize another tenant for the same authenticated user', () => {
    const membership = selectActiveMembership('auth-1', 'tenant-b', [
      {
        id: 'user-doc-1',
        data: {
          authUserId: 'auth-1',
          tenantId: 'tenant-a',
          role: 'OWNER',
          status: 'ACTIVE',
        },
      },
    ]);

    expect(membership).toBeNull();
  });

  it('does not authorize inactive or role-less memberships', () => {
    expect(selectActiveMembership('auth-1', 'tenant-a', [
      {
        id: 'inactive',
        data: {
          authUserId: 'auth-1',
          tenantId: 'tenant-a',
          role: 'OWNER',
          status: 'INACTIVE',
        },
      },
    ])).toBeNull();

    expect(selectActiveMembership('auth-1', 'tenant-a', [
      {
        id: 'role-less',
        data: {
          authUserId: 'auth-1',
          tenantId: 'tenant-a',
          role: '   ',
          status: 'ACTIVE',
        },
      },
    ])).toBeNull();
  });

  it('lists only active memberships belonging to the authenticated principal', () => {
    const memberships = listActiveMembershipsFromDocuments('auth-1', [
      { id: 'a', data: { authUserId: 'auth-1', tenantId: 'tenant-a', role: 'OWNER', status: 'ACTIVE' } },
      { id: 'b', data: { authUserId: 'auth-1', tenantId: 'tenant-b', role: 'AGENT', status: 'ACTIVE' } },
      { id: 'inactive', data: { authUserId: 'auth-1', tenantId: 'tenant-c', role: 'OWNER', status: 'INACTIVE' } },
      { id: 'other', data: { authUserId: 'auth-2', tenantId: 'tenant-z', role: 'OWNER', status: 'ACTIVE' } },
    ]);

    expect(memberships.map(({ tenantId, role }) => ({ tenantId, role }))).toEqual([
      { tenantId: 'tenant-a', role: 'OWNER' },
      { tenantId: 'tenant-b', role: 'AGENT' },
    ]);
  });
});
