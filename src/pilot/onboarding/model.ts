import type {HalfHalfPricingRule} from '../../commerce/model';
import type {OperationMode,BusinessVertical} from '../../business/model';

export type PilotPaymentPreference='PIX'|'PAYMENT_LINK'|'CHECKOUT'|'PIX_MANUAL'|'CASH_ON_DELIVERY'|'CARD_ON_DELIVERY';
export type PilotStaffRole='OWNER'|'ADMIN'|'MANAGER'|'ATTENDANT'|'OPERATOR'|'STAFF'|'CASHIER'|'DELIVERY';
export interface PilotWeeklyHour {day:number;closed:boolean;open:string;close:string;}
export interface PilotPostalFee {zoneId:string;fromCep:string;toCep:string;feeMinor:number;}
export interface PilotRegistrationDraft {
 vertical:BusinessVertical;
 businessName:string;
 address:{street:string;number:string;district:string;municipality:string;state:string;postalCode:string};
 contact:{whatsappE164:string;alternatePhoneE164:string};
 assistantName:string;
 schedule:PilotWeeklyHour[];
 menu:{sourceRef:string;catalogVersion:number;pizzaFlavorCount:number;
  comboCount:number;halfHalfPricing:HalfHalfPricingRule|null;
  ingredientsReviewed:boolean;allergenEscalationAcknowledged:boolean};
 fulfillment:{pickupEnabled:boolean;deliveryEnabled:boolean;postalFees:PilotPostalFee[];
  prepMinutes:number;deliveryMinutes:number;pickupMinutes:number};
 preferredPaymentMethods:PilotPaymentPreference[];
 plannedStaffRoles:PilotStaffRole[];
}
export interface PilotModeDecision {
 mode:OperationMode;selectedBy:string;selectedAt:string;reason:string;
 externalSystemName?:string;
}
export interface PilotOwnerAttestation {
 attestedBy:string;attestedAt:string;sourceVersion:number;requestId:string;
 recordHash:string;statement:'CONFIRMO OS DADOS E O MODO OPERACIONAL DA EMPRESA';
 evidenceRef:string;catalogVersion:number;profileVersion:number;
}
export interface PilotRegistrationRecord {
 tenantId:string;unitId:string;version:number;status:'DRAFT'|'OWNER_ATTESTED';
 data:PilotRegistrationDraft;modeDecision?:PilotModeDecision;attestation?:PilotOwnerAttestation;
 updatedBy:string;updatedAt:string;createdAt:string;
}
export type PilotGateStatus='READY'|'MISSING'|'CONFLICT';
export interface PilotRegistrationCheck {code:string;status:PilotGateStatus;detail:string;}
export interface PilotRegistrationReport {
 tenantId:string;unitId:string;version:number;
 status:'NO_GO'|'OWNER_ATTESTED';checks:PilotRegistrationCheck[];
 selectedMode:OperationMode|null;operationalActivationAllowed:false;
 nextGate:'T08.1_OWNER_VALIDATION'|'T08.2_REQUIRES_SEPARATE_AUTHORIZATION';
}
export interface PilotRegistrationRepository {
 latest(tenantId:string,unitId:string):Promise<PilotRegistrationRecord|null>;
 save(next:PilotRegistrationRecord,expectedVersion:number):Promise<PilotRegistrationRecord>;
}
