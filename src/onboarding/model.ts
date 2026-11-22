import type {BusinessProfileRevision,BusinessVertical,OperationMode} from '../business/model';
import type {CapabilityAssignment,CapabilityId,CapabilityTemplateId} from '../capabilities/model';
export interface OnboardingTemplate{id:string;label:string;vertical:BusinessVertical;templateId:CapabilityTemplateId;native:CapabilityId[];integrated:CapabilityId[]}
export interface OnboardingRecord{
 tenantId:string;unitId:string;templateId:string;mode:OperationMode;fingerprint:string;profile:BusinessProfileRevision;assignment:CapabilityAssignment;
 createdAt:string;createdBy:string;commercialGoLiveAuthorized:false;
}
export interface OnboardingStore{
 create(record:OnboardingRecord):Promise<OnboardingRecord>;
 get(t:string,u:string):Promise<OnboardingRecord|null>;
}
