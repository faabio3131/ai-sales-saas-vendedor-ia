import type {BusinessVertical,OperationMode} from '../business/model';
export type CapabilityId =
 'CORE_KNOWLEDGE'|'CORE_CUSTOMERS'|'CORE_AI_ASSIST'|
 'FOOD_ORDERING'|'FOOD_PRODUCTION'|'FOOD_DELIVERY'|'FOOD_FINANCE'|
 'RETAIL_CATALOG'|'RETAIL_CHECKOUT'|'RETAIL_INVENTORY'|
 'SERVICE_CATALOG'|'SCHEDULING'|'SERVICE_BOOKING'|
 'BEAUTY_SERVICES'|'BEAUTY_BOOKING'|'HEALTH_ADMIN';
export type CapabilityDomain='CORE'|'FOOD_SERVICE'|'RETAIL'|'SERVICES'|'BEAUTY'|'HEALTH_SERVICE';
export type CapabilityMaturity='READY_INTERNAL'|'PLANNED';
export type CapabilityTemplateId =
 'FOOD_SERVICE_STD'|'RETAIL_STD'|'SERVICES_STD'|'BEAUTY_STD'|'HEALTH_ADMIN_STD'|'GENERAL_STD';
export interface CapabilityManifest{
 id:CapabilityId;domain:CapabilityDomain;version:1;
 maturity:CapabilityMaturity;dependsOn:readonly CapabilityId[];
 /** All business capabilities remain governed, never equal to commercial go-live. */
 certification:'INTERNAL_ONLY'|'FUTURE_IMPLEMENTATION';
}
export interface CapabilityTemplate{
 id:CapabilityTemplateId;version:1;vertical:BusinessVertical;
 capabilities:readonly CapabilityId[];
 defaultEnabled:readonly CapabilityId[];
}
export interface CapabilityAssignment{
 schemaVersion:1;tenantId:string;unitId:string;version:number;
 templateId:CapabilityTemplateId;templateVersion:1;vertical:BusinessVertical;
 enabledCapabilities:CapabilityId[];
 pendingCapabilities:CapabilityId[];
 state:'ENABLED_INTERNAL'|'DISABLED';
 operationMode:OperationMode;profileVersion:number;
 createdAt:string;createdBy:string;reason:string;
 rollbackOfVersion?:number;
}
export interface CapabilityPublishInput{
 expectedVersion:number;templateId:CapabilityTemplateId;templateVersion:1;
 enabledCapabilities:CapabilityId[];reason:string;
}
export interface CapabilityRollbackInput {
 expectedVersion:number;restoreVersion:number;reason:string;
}
export interface CapabilityRepository{
 latest(tenantId:string,unitId:string):Promise<CapabilityAssignment|null>;
 version(tenantId:string,unitId:string,version:number):Promise<CapabilityAssignment|null>;
 publish(next:CapabilityAssignment,expectedVersion:number):Promise<void>;
 planEligible?(tenantId:string,unitId:string,now:number):Promise<boolean>;
}
export interface CapabilityResolution {
 tenantId:string;unitId:string;capability:CapabilityId;
 authorized:boolean;
 status:'ALLOWED_INTERNAL'|'NOT_CONFIGURED'|'DISABLED'|'NOT_ENABLED'|
 'FUTURE_IMPLEMENTATION'|'TEMPLATE_MISMATCH'|'PROFILE_UNAVAILABLE'|'PLAN_INACTIVE';
 assignmentVersion?:number;templateId?:CapabilityTemplateId;
 commercialGoLiveAuthorized:false;
}
