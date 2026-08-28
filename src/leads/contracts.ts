import { Lead, Opportunity } from './model';

export interface LeadRepository {
  listByTenant(tenantId: string): Promise<Lead[]>;
  findById(tenantId: string, id: string): Promise<Lead | null>;
  findActiveByCustomer(tenantId: string, customerId: string): Promise<Lead | null>;
  create(lead: Lead): Promise<Lead>;
  update(lead: Lead): Promise<Lead>;
}

export interface OpportunityRepository {
  listByTenant(tenantId: string): Promise<Opportunity[]>;
  findById(tenantId: string, id: string): Promise<Opportunity | null>;
  create(opportunity: Opportunity): Promise<Opportunity>;
  update(opportunity: Opportunity): Promise<Opportunity>;
}
