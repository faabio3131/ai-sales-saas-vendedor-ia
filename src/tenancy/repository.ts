import { TenantMembership, TenantMembershipRepository } from './contracts';

export class InMemoryTenantMembershipRepository implements TenantMembershipRepository {
  constructor(private readonly memberships: TenantMembership[]) {}

  async findActiveMembership(authUserId: string, tenantId: string): Promise<TenantMembership | null> {
    return this.memberships.find(
      (membership) =>
        membership.authUserId === authUserId &&
        membership.tenantId === tenantId &&
        membership.status === 'ACTIVE',
    ) ?? null;
  }
}
