export interface WorkspaceMembership {
  tenantId: string;
  userId: string;
  role: string;
  status: 'ACTIVE';
}

export type WorkspaceMembershipResolution =
  | { kind: 'AUTHORIZED'; memberships: WorkspaceMembership[]; tenantId: string }
  | { kind: 'BLOCKED'; memberships: WorkspaceMembership[]; tenantId: '' }
  | { kind: 'ERROR'; memberships: WorkspaceMembership[]; tenantId: '' };

export function resolveWorkspaceMemberships(params: {
  responseStatus: number;
  memberships?: WorkspaceMembership[];
  rememberedTenantId?: string | null;
}): WorkspaceMembershipResolution {
  const memberships = params.memberships ?? [];

  if (params.responseStatus === 403 || (params.responseStatus >= 200 && params.responseStatus < 300 && memberships.length === 0)) {
    return { kind: 'BLOCKED', memberships: [], tenantId: '' };
  }

  if (params.responseStatus < 200 || params.responseStatus >= 300) {
    return { kind: 'ERROR', memberships: [], tenantId: '' };
  }

  const remembered = params.rememberedTenantId?.trim();
  const tenantId = memberships.find((item) => item.tenantId === remembered)?.tenantId ?? memberships[0].tenantId;

  return { kind: 'AUTHORIZED', memberships, tenantId };
}
