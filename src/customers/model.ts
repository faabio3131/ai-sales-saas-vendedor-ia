export type CustomerStatus = 'ACTIVE' | 'INACTIVE';

export interface ExternalIdentity {
  source: string;
  value: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  phone?: string;
  email?: string;
  externalIdentities: ExternalIdentity[];
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMemory {
  id: string;
  tenantId: string;
  customerId: string;
  summary: string;
  interests: string[];
  productIds: string[];
  serviceIds: string[];
  objections: string[];
  preferences: string[];
  lastContactAt?: string;
  lastFollowUpAt?: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  name: string;
  phone?: string;
  email?: string;
  externalIdentities?: ExternalIdentity[];
  status?: CustomerStatus;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  externalIdentities?: ExternalIdentity[];
  status?: CustomerStatus;
}

export interface UpdateCustomerMemoryInput {
  summary?: string;
  interests?: string[];
  productIds?: string[];
  serviceIds?: string[];
  objections?: string[];
  preferences?: string[];
  lastContactAt?: string | null;
  lastFollowUpAt?: string | null;
}
