/** T02: versioned, tenant/unit-scoped commercial knowledge and operation capabilities. */
export const BUSINESS_VERTICALS = ['FOOD_SERVICE','RETAIL','SERVICES','BEAUTY','HEALTH_SERVICE','OTHER'] as const;
export type BusinessVertical = (typeof BUSINESS_VERTICALS)[number];
export const BUSINESS_CAPABILITIES = ['FOOD_SERVICE','ORDERING','PRODUCTION','DELIVERY'] as const;
export type BusinessCapability = (typeof BUSINESS_CAPABILITIES)[number];
export type OperationMode = 'NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS';
export type FactKind = 'FAQ'|'HOURS'|'DELIVERY'|'POLICY'|'CONTACT'|'GENERAL';

export interface ApprovedBusinessFact {
  id: string;
  kind: FactKind;
  question: string;
  answer: string;
  sourceRef: string;
}
export interface PolicyProfile {
  timezone: string;
  locale: 'pt-BR';
  memoryRetentionDays: number;
  personalMemoryDefault: 'DENY';
  prohibitUnverifiedClaims: true;
}
export interface BusinessCapabilityRegistry {
  vertical: BusinessVertical;
  capabilities: BusinessCapability[];
  operationMode: OperationMode;
  /** Future PDV/KDS integration is NEVER activated by selecting a mode alone. */
  integrationStatus: 'NOT_CONFIGURED';
}
export interface BusinessIdentity {
  assistantName: string;
  voiceStyle: 'PROFESSIONAL'|'FRIENDLY'|'DIRECT';
}
export interface BusinessProfileRevision {
  tenantId: string;
  unitId: string;
  version: number;
  effectiveFrom: string;
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  identity: BusinessIdentity;
  capabilityRegistry: BusinessCapabilityRegistry;
  policy: PolicyProfile;
  facts: ApprovedBusinessFact[];
}
export interface BusinessProfileInput {
  expectedVersion: number;
  effectiveFrom: string;
  expiresAt?: string|null;
  identity: BusinessIdentity;
  capabilityRegistry: BusinessCapabilityRegistry;
  policy: PolicyProfile;
  facts: ApprovedBusinessFact[];
}
export interface GroundedBusinessAnswer {
  status:'ANSWERED'|'UNKNOWN'|'CONFLICT';
  answer?:string;
  evidenceIds:string[];
  profileVersion?:number;
  source:'CATALOG'|'BUSINESS_APPROVED'|'NONE';
}
