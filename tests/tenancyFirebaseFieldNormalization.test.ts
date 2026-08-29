import { describe, expect, it } from 'vitest';
import { readMembershipStringField, selectActiveMembership } from '../src/tenancy/firebaseMembershipRepository';

describe('OP-020: Firestore membership normalization', () => {
  it('reads exact string fields and trims values', () => {
    expect(readMembershipStringField({ role: ' OWNER ' }, 'role')).toBe('OWNER');
  });

  it('recovers manually-created field keys with whitespace or case drift', () => {
    expect(readMembershipStringField({ ' role ': 'OWNER' }, 'role')).toBe('OWNER');
    expect(readMembershipStringField({ ROLE: 'ADMIN' }, 'role')).toBe('ADMIN');
  });

  it('authorizes a valid membership even when a manually-entered key has harmless drift', () => {
    const membership = selectActiveMembership('auth-1', 'tenant-a', [
      {
        id: 'membership-1',
        data: {
          authUserId: 'auth-1',
          tenantId: 'tenant-a',
          status: 'ACTIVE',
          ' role ': 'OWNER',
        },
      },
    ]);

    expect(membership).toEqual({
      tenantId: 'tenant-a',
      authUserId: 'auth-1',
      userId: 'membership-1',
      role: 'OWNER',
      status: 'ACTIVE',
    });
  });

  it('still fails closed when role is truly absent', () => {
    expect(selectActiveMembership('auth-1', 'tenant-a', [
      {
        id: 'membership-1',
        data: {
          authUserId: 'auth-1',
          tenantId: 'tenant-a',
          status: 'ACTIVE',
        },
      },
    ])).toBeNull();
  });
});
