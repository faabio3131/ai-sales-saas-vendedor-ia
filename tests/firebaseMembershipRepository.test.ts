import { describe, expect, it } from 'vitest';
import { selectActiveMembership } from '../src/tenancy/firebaseMembershipRepository';

describe('OP-020: Firebase tenant membership selection', () => {
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
});
