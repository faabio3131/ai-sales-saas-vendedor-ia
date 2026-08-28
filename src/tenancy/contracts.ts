export interface TenantMembership {
  tenantId: string;
  authUserId: string;
  userId: string;
  role: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface TenantMembershipRepository {
  findActiveMembership(authUserId: string, tenantId: string): Promise<TenantMembership | null>;
}
