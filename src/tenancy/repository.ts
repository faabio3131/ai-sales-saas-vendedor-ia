import { TenantMembership, TenantMembershipRepository } from './contracts';

export class InMemoryTenantMembershipRepository implements TenantMembershipRepository {
  constructor(private readonly memberships: TenantMembership[]) {}

  async listActiveMemberships(authUserId: string): Promise<TenantMembership[]> {
    return this.memberships.filter(
      (membership) =>
        membership.authUserId === authUserId &&
        membership.status === 'ACTIVE' &&
        membership.role.trim().length > 0,
    );
  }

  async findActiveMembership(authUserId: string, tenantId: string): Promise<TenantMembership | null> {
    const memberships = await this.listActiveMemberships(authUserId);
    return memberships.find((membership) => membership.tenantId === tenantId) ?? null;
  }
}
