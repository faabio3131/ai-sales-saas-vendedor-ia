import {createHash} from 'node:crypto';
import {ApplicationError} from '../../infrastructure/errors';
import type {TenantContext} from '../../types/contracts';
import {BUSINESS_VERTICALS,type BusinessVertical} from '../../business/model';
import {requireBusinessScope} from '../../business/service';
import type {PilotRegistrationDraft,PilotPostalFee,PilotWeeklyHour,
 PilotPaymentPreference,PilotStaffRole,PilotRegistrationRecord} from './model';

export function rejected(code:string,category:'VALIDATION'|'FORBIDDEN'|'CONFLICT'|'NOT_FOUND'='VALIDATION'):never{
 throw new ApplicationError({code,category,message:'Pilot onboarding request rejected or evidence is incomplete.'});
}
export function ownerScope(ctx:TenantContext,unitId:string){
 if(ctx.role!=='OWNER'||!ctx.userId?.trim())rejected('PILOT_OWNER_REQUIRED','FORBIDDEN');
 return requireBusinessScope(ctx,unitId);
}
function plain(value:unknown):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
}
function only(raw:unknown,keys:string[],code='PILOT_FIELDS_INVALID'):asserts raw is Record<string,unknown>{
 if(!plain(raw)||Object.keys(raw).some(k=>!keys.includes(k)||['__proto__','constructor','prototype'].includes(k)))
  rejected(code);
}
function printable(value:unknown,max:number):string{
 if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))rejected('PILOT_TEXT_INVALID');
 return value.trim();
}
function number(value:unknown,min:number,max:number):number{
 if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)
  rejected('PILOT_NUMBER_INVALID');
 return value as number;
}
const ID=/^[A-Za-z0-9_-]{1,96}$/;
const METHODS:PilotPaymentPreference[]=['PIX','PAYMENT_LINK','CHECKOUT','PIX_MANUAL','CASH_ON_DELIVERY','CARD_ON_DELIVERY'];
const ROLES:PilotStaffRole[]=['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF','CASHIER','DELIVERY'];
function unique<T>(values:T[],code:string):T[]{
 if(new Set(values).size!==values.length)rejected(code);
 return values;
}
function time(raw:unknown):string{
 const v=printable(raw,5);
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))rejected('PILOT_HOUR_INVALID');
 return v;
}
function weekly(raw:unknown):PilotWeeklyHour[]{
 if(!Array.isArray(raw)||raw.length>7)rejected('PILOT_SCHEDULE_INVALID');
 const values=raw.map(v=>{
  only(v,['day','closed','open','close'],'PILOT_SCHEDULE_INVALID');
  const day=number(v.day,0,6);
  if(typeof v.closed!=='boolean')rejected('PILOT_SCHEDULE_INVALID');
  const open=v.closed?'':time(v.open),close=v.closed?'':time(v.close);
  if(!v.closed&&open===close)rejected('PILOT_SCHEDULE_INVALID');
  if(v.closed&&(v.open!==''||v.close!==''))rejected('PILOT_SCHEDULE_INVALID');
  return {day,closed:v.closed,open,close};
 });
 unique(values.map(x=>x.day),'PILOT_SCHEDULE_DUPLICATE_DAY');
 return values.sort((a,b)=>a.day-b.day);
}
function postal(raw:unknown):PilotPostalFee[]{
 if(!Array.isArray(raw)||raw.length>60)rejected('PILOT_POSTAL_ZONES_INVALID');
 const ranges=raw.map(v=>{
  only(v,['zoneId','fromCep','toCep','feeMinor'],'PILOT_POSTAL_ZONES_INVALID');
  const zoneId=printable(v.zoneId,96);
  if(!ID.test(zoneId))rejected('PILOT_ZONE_INVALID');
  const fromCep=printable(v.fromCep,8),toCep=printable(v.toCep,8);
  if(!/^\d{8}$/.test(fromCep)||!/^\d{8}$/.test(toCep)||fromCep>toCep)
   rejected('PILOT_CEP_RANGE_INVALID');
  return {zoneId,fromCep,toCep,feeMinor:number(v.feeMinor,0,10000000)};
 }).sort((a,b)=>a.fromCep.localeCompare(b.fromCep));
 for(let i=1;i<ranges.length;i++){
  if(ranges[i].fromCep<=ranges[i-1].toCep)rejected('PILOT_CEP_RANGE_OVERLAP');
 }
 return ranges;
}
export function validateDraft(input:unknown):PilotRegistrationDraft{
 only(input,['vertical','businessName','address','contact','assistantName','schedule','menu',
 'fulfillment','preferredPaymentMethods','plannedStaffRoles'],'PILOT_DRAFT_INVALID');
 only(input.address,['street','number','district','municipality','state','postalCode'],'PILOT_ADDRESS_INVALID');
 only(input.contact,['whatsappE164','alternatePhoneE164'],'PILOT_CONTACT_INVALID');
 only(input.menu,['sourceRef','catalogVersion','pizzaFlavorCount','comboCount',
  'halfHalfPricing','ingredientsReviewed','allergenEscalationAcknowledged'],'PILOT_MENU_INVALID');
 only(input.fulfillment,['pickupEnabled','deliveryEnabled','postalFees',
  'prepMinutes','deliveryMinutes','pickupMinutes'],'PILOT_DELIVERY_INVALID');
 const a=input.address,c=input.contact,m=input.menu,f=input.fulfillment;
 const vertical=input.vertical===undefined?'FOOD_SERVICE':input.vertical;
 if(!BUSINESS_VERTICALS.includes(vertical as BusinessVertical))rejected('PILOT_VERTICAL_INVALID');
 if(!Array.isArray(input.preferredPaymentMethods)||input.preferredPaymentMethods.length>METHODS.length||
   input.preferredPaymentMethods.some(v=>!METHODS.includes(v as PilotPaymentPreference)))
  rejected('PILOT_PAYMENT_PREFERENCES_INVALID');
 if(!Array.isArray(input.plannedStaffRoles)||input.plannedStaffRoles.length>ROLES.length||
   input.plannedStaffRoles.some(v=>!ROLES.includes(v as PilotStaffRole)))
  rejected('PILOT_ROLE_PLAN_INVALID');
 if(typeof m.ingredientsReviewed!=='boolean'||typeof m.allergenEscalationAcknowledged!=='boolean'||
   typeof f.pickupEnabled!=='boolean'||typeof f.deliveryEnabled!=='boolean'||
   ![null,'MAX_FLAVOR','AVERAGE_CEIL'].includes(m.halfHalfPricing as string|null))
  rejected('PILOT_FLAGS_INVALID');
 const methods=unique([...input.preferredPaymentMethods] as PilotPaymentPreference[],'PILOT_PAYMENT_PREFERENCES_DUPLICATE');
 const roles=unique([...input.plannedStaffRoles] as PilotStaffRole[],'PILOT_ROLE_PLAN_DUPLICATE');
 return {
  vertical:vertical as BusinessVertical,
  businessName:printable(input.businessName,120),address:{
   street:printable(a.street,160),number:printable(a.number,20),
   district:printable(a.district,80),municipality:printable(a.municipality,80),
   state:printable(a.state,2),postalCode:printable(a.postalCode,8),
  },
  contact:{whatsappE164:printable(c.whatsappE164,16),
   alternatePhoneE164:printable(c.alternatePhoneE164,16)},
  assistantName:printable(input.assistantName,60),
  schedule:weekly(input.schedule),
  menu:{sourceRef:printable(m.sourceRef,180),catalogVersion:number(m.catalogVersion,0,1000000),
   pizzaFlavorCount:number(m.pizzaFlavorCount,0,1000),comboCount:number(m.comboCount,0,1000),
   halfHalfPricing:m.halfHalfPricing as PilotRegistrationDraft['menu']['halfHalfPricing'],
   ingredientsReviewed:m.ingredientsReviewed,allergenEscalationAcknowledged:m.allergenEscalationAcknowledged},
  fulfillment:{pickupEnabled:f.pickupEnabled,deliveryEnabled:f.deliveryEnabled,
   postalFees:postal(f.postalFees),prepMinutes:number(f.prepMinutes,0,240),
   deliveryMinutes:number(f.deliveryMinutes,0,240),pickupMinutes:number(f.pickupMinutes,0,240)},
  preferredPaymentMethods:methods,plannedStaffRoles:roles,
 };
}
export function defaultPilotDraft():PilotRegistrationDraft{
 return {vertical:'FOOD_SERVICE',businessName:'',address:{street:'',number:'',district:'',municipality:'',state:'',postalCode:''},
  contact:{whatsappE164:'',alternatePhoneE164:''},assistantName:'',schedule:[],
  menu:{sourceRef:'',catalogVersion:0,pizzaFlavorCount:0,comboCount:0,
   halfHalfPricing:null,ingredientsReviewed:false,allergenEscalationAcknowledged:false},
  fulfillment:{pickupEnabled:false,deliveryEnabled:false,postalFees:[],
   prepMinutes:0,deliveryMinutes:0,pickupMinutes:0},
  preferredPaymentMethods:[],plannedStaffRoles:[]};
}
function stable(v:unknown):string{
 if(v===null||typeof v==='string'||typeof v==='number'||typeof v==='boolean')
  return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(stable).join(',')+']';
 if(!plain(v))rejected('PILOT_HASH_DATA_INVALID');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
}
export function recordHash(r:Pick<PilotRegistrationRecord,'tenantId'|'unitId'|'data'|'modeDecision'>):string{
 return createHash('sha256').update(stable({tenantId:r.tenantId,unitId:r.unitId,
  data:r.data,modeDecision:r.modeDecision??null})).digest('hex');
}
export const ATTESTATION_STATEMENT='CONFIRMO OS DADOS E O MODO OPERACIONAL DA EMPRESA';
export function ownerAttestationInput(raw:unknown){
 only(raw,['expectedVersion','statement','evidenceRef'],'PILOT_ATTESTATION_INVALID');
 if(raw.statement!==ATTESTATION_STATEMENT)rejected('PILOT_ATTESTATION_STATEMENT_REQUIRED');
 const evidenceRef=printable(raw.evidenceRef,180);
 if(!/^(?:document|owner-approval):[A-Za-z0-9_:/.-]{8,160}$/.test(evidenceRef))
  rejected('PILOT_OWNER_EVIDENCE_REFERENCE_REQUIRED');
 return {expectedVersion:number(raw.expectedVersion,1,1000000),evidenceRef};
}
export function modeInput(raw:unknown){
 only(raw,['expectedVersion','mode','reason','externalSystemName'],'PILOT_MODE_INPUT_INVALID');
 if(!['NATIVE_OPERATIONS','INTEGRATED_OPERATIONS'].includes(String(raw.mode)))
  rejected('PILOT_MODE_INVALID');
 const mode=raw.mode as 'NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS';
 const reason=printable(raw.reason,220);
 if(reason.length<8)rejected('PILOT_MODE_REASON_REQUIRED');
 const ext=raw.externalSystemName===undefined?'':printable(raw.externalSystemName,100);
 if(mode==='NATIVE_OPERATIONS'&&ext)rejected('PILOT_NATIVE_CONNECTOR_FORBIDDEN');
 if(mode==='INTEGRATED_OPERATIONS'&&ext.length<2)rejected('PILOT_EXTERNAL_SYSTEM_REQUIRED');
 return {expectedVersion:number(raw.expectedVersion,1,1000000),mode,reason,
  ...(ext?{externalSystemName:ext}:{})};
}
