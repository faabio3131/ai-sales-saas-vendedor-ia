export interface ScopedCustomerMemory {
  tenantId:string;
  unitId:string;
  customerId:string;
  version:number;
  status:'GRANTED'|'REVOKED';
  consentEvidenceRef?:string;
  consentAt?:string;
  summary:string;
  interests:string[];
  preferences:string[];
  sourceRefs:string[];
  updatedAt:string;
  expiresAt:string;
  updatedBy:string;
}
export interface UpdateScopedMemoryInput {
  expectedVersion:number;
  summary:string;
  interests?:string[];
  preferences?:string[];
  sourceRefs:string[];
}
export interface ChangeMemoryConsentInput {
  expectedVersion:number;
  grant:boolean;
  /** Authorized operator documents independently captured, customer-specific evidence. */
  consentEvidenceRef?:string;
}
