import { describe, expect, it } from 'vitest';
import { resolveWorkspaceMemberships, WorkspaceMembership } from '../src/ui/workspaceAccess';

const membership: WorkspaceMembership = {
  tenantId: 'tenant-a',
  userId: 'user-a',
  role: 'OWNER',
  status: 'ACTIVE',
};

describe('resolveWorkspaceMemberships', () => {
  it('blocks authenticated users when backend denies membership discovery', () => {
    expect(resolveWorkspaceMemberships({ responseStatus: 403 })).toEqual({
      kind: 'BLOCKED',
      memberships: [],
      tenantId: '',
    });
  });

  it('fails closed defensively when a successful response has no active memberships', () => {
    expect(resolveWorkspaceMemberships({ responseStatus: 200, memberships: [] })).toEqual({
      kind: 'BLOCKED',
      memberships: [],
      tenantId: '',
    });
  });

  it('does not treat unrelated backend errors as authorization', () => {
    expect(resolveWorkspaceMemberships({ responseStatus: 500 })).toEqual({
      kind: 'ERROR',
      memberships: [],
      tenantId: '',
    });
  });

  it('selects the remembered tenant only when it is present in authorized memberships', () => {
    const second: WorkspaceMembership = { ...membership, tenantId: 'tenant-b' };
    expect(resolveWorkspaceMemberships({
      responseStatus: 200,
      memberships: [membership, second],
      rememberedTenantId: 'tenant-b',
    })).toEqual({
      kind: 'AUTHORIZED',
      memberships: [membership, second],
      tenantId: 'tenant-b',
    });
  });

  it('falls back to the first authorized tenant instead of trusting stale local storage', () => {
    expect(resolveWorkspaceMemberships({
      responseStatus: 200,
      memberships: [membership],
      rememberedTenantId: 'tenant-forbidden',
    })).toEqual({
      kind: 'AUTHORIZED',
      memberships: [membership],
      tenantId: 'tenant-a',
    });
  });
});
