import type {TenantContext} from '../../types/contracts';
import type {BusinessProfileRepository} from '../../business/contracts';
import type {UnitCatalogRepository,UnitCatalogRevision} from '../../commerce/model';
import type {PilotRegistrationDraft,PilotRegistrationCheck,PilotRegistrationRecord,
 PilotRegistrationReport,PilotRegistrationRepository} from './model';
import {ATTESTATION_STATEMENT,defaultPilotDraft,modeInput,ownerAttestationInput,
 ownerScope,recordHash,rejected,validateDraft} from './validation';

const e164=/^55\d{10,11}$/;
function verifyMenuPrices(catalog:UnitCatalogRevision){
 const active=catalog.items.filter(i=>i.active);
 if(!active.length)return false;
 for(const item of active){
  if(item.kind==='PIZZA'){
   if(!item.pizza||!item.pizza.sizes.some(s=>s.active)||
      !item.pizza.flavors.some(f=>f.active))return false;
   for(const flavor of item.pizza.flavors.filter(f=>f.active)){
    for(const size of item.pizza.sizes.filter(s=>s.active)){
     if(!Number.isSafeInteger(flavor.pricesBySize[size.id])||
       flavor.pricesBySize[size.id]<=0)return false;
    }
   }
  }else if(!Number.isSafeInteger(item.priceMinor)||!item.priceMinor||item.priceMinor<=0){
   return false;
  }
 }
 return true;
}
function menuCounts(catalog:UnitCatalogRevision){
 return {flavors:catalog.items.filter(x=>x.active&&x.kind==='PIZZA')
   .reduce((n,x)=>n+(x.pizza?.flavors.filter(f=>f.active).length??0),0),
  combos:catalog.items.filter(x=>x.active&&x.kind==='COMBO').length};
}
export interface PilotRegistrationView {
 record:PilotRegistrationRecord|null;
 report:PilotRegistrationReport;
 blankDraft:PilotRegistrationDraft;
}
export class PilotRegistrationService{
 constructor(private readonly repository:PilotRegistrationRepository,
  private readonly profiles:Pick<BusinessProfileRepository,'effective'|'latest'>,
  private readonly catalog:Pick<UnitCatalogRepository,'latest'|'effective'>,
  private readonly clock:()=>Date=()=>new Date()){}
 async get(ctx:TenantContext,unitId:string):Promise<PilotRegistrationView>{
  const s=ownerScope(ctx,unitId);
  const record=await this.repository.latest(s.tenantId,s.unitId);
  return {record,report:await this.report(s,record),blankDraft:defaultPilotDraft()};
 }
 async saveDraft(ctx:TenantContext,unitId:string,raw:unknown){
  const s=ownerScope(ctx,unitId);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    Object.keys(raw).some(k=>!['expectedVersion','data'].includes(k)))
   rejected('PILOT_SAVE_FIELDS_INVALID');
  const input=raw as {expectedVersion:unknown;data:unknown};
  if(!Number.isSafeInteger(input.expectedVersion)||Number(input.expectedVersion)<0)
   rejected('PILOT_VERSION_INVALID');
  const current=await this.repository.latest(s.tenantId,s.unitId);
  if((current?.version??0)!==input.expectedVersion)
   rejected('PILOT_VERSION_CONFLICT','CONFLICT');
  const data=validateDraft(input.data);
  const now=this.clock().toISOString();
  const next:PilotRegistrationRecord={...s,version:Number(input.expectedVersion)+1,
   status:'DRAFT',data,createdAt:current?.createdAt??now,updatedAt:now,
   updatedBy:ctx.userId!,...(current?.modeDecision?{modeDecision:current.modeDecision}:{})};
  return this.repository.save(next,Number(input.expectedVersion));
 }
 async selectMode(ctx:TenantContext,unitId:string,raw:unknown){
  const s=ownerScope(ctx,unitId);
  const input=modeInput(raw);
  const current=await this.repository.latest(s.tenantId,s.unitId);
  if(!current)rejected('PILOT_DRAFT_REQUIRED','NOT_FOUND');
  if(current.version!==input.expectedVersion)rejected('PILOT_VERSION_CONFLICT','CONFLICT');
  const now=this.clock().toISOString();
  const next:PilotRegistrationRecord={...current,version:current.version+1,
   status:'DRAFT',updatedAt:now,updatedBy:ctx.userId!,modeDecision:{
    mode:input.mode,reason:input.reason,selectedBy:ctx.userId!,
    selectedAt:now,...(input.externalSystemName?{externalSystemName:input.externalSystemName}:{})},
  };
  delete next.attestation;
  // Choosing a mode is an owner-approved intent ONLY. It never publishes
  // T02 business capabilities or T06 kitchen/PDV settings.
  return this.repository.save(next,current.version);
 }
 async attest(ctx:TenantContext,unitId:string,raw:unknown){
  const s=ownerScope(ctx,unitId),input=ownerAttestationInput(raw);
  const current=await this.repository.latest(s.tenantId,s.unitId);
  if(!current)rejected('PILOT_DRAFT_REQUIRED','NOT_FOUND');
  if(current.version!==input.expectedVersion)
   rejected('PILOT_VERSION_CONFLICT','CONFLICT');
  const assessed=await this.evaluate(s,current);
  if(assessed.checks.some(x=>x.status!=='READY'))
   rejected('PILOT_OWNER_REVIEW_INCOMPLETE','CONFLICT');
  if(!assessed.profileVersion||!assessed.catalogVersion)
   rejected('PILOT_SOURCE_REVISIONS_MISSING','CONFLICT');
  const now=this.clock().toISOString();
  const next:PilotRegistrationRecord={...current,version:current.version+1,
   status:'OWNER_ATTESTED',updatedAt:now,updatedBy:ctx.userId!,
   attestation:{attestedBy:ctx.userId!,attestedAt:now,sourceVersion:current.version,
    requestId:ctx.requestId,recordHash:recordHash(current),statement:ATTESTATION_STATEMENT,
    evidenceRef:input.evidenceRef,catalogVersion:assessed.catalogVersion,
    profileVersion:assessed.profileVersion},
  };
  return this.repository.save(next,current.version);
 }
 private async evaluate(s:{tenantId:string;unitId:string},record:PilotRegistrationRecord|null){
  const checks:PilotRegistrationCheck[]=[];
  const add=(code:string,ok:boolean,detail:string,conflict=false)=>{
   checks.push({code,status:ok?'READY':conflict?'CONFLICT':'MISSING',detail});
  };
  let catalogVersion=0,profileVersion=0;
  if(!record){add('OWNER_DRAFT',false,'Missing real, tenant-scoped onboarding record.');
   return {checks,catalogVersion,profileVersion};}
  const d=record.data,a=d.address,m=d.menu,f=d.fulfillment;
  add('BUSINESS_IDENTITY',d.businessName.length>=3&&a.street.length>=3&&
   a.number.length>=1&&a.district.length>=2&&a.municipality.length>=2&&
   /^[A-Z]{2}$/.test(a.state)&&/^\d{8}$/.test(a.postalCode),
   'Legal store location, municipality, neighborhood and CEP must be owner confirmed.');
  add('CONTACT_CHANNEL',e164.test(d.contact.whatsappE164)&&
   (!d.contact.alternatePhoneE164||e164.test(d.contact.alternatePhoneE164)),
   'WhatsApp contact must be owner confirmed; this does not activate WhatsApp.');
  add('ASSISTANT_NAME',d.assistantName.length>=2,
   'An owner-chosen, tenant-specific assistant name is mandatory.');
  add('OPENING_HOURS',d.schedule.length===7&&d.schedule.some(day=>!day.closed),
   'All seven days must be explicitly open with hours or closed.');
  add('MENU_OWNER_REVIEW',m.sourceRef.length>=8&&m.catalogVersion>0&&
   m.pizzaFlavorCount>0&&m.comboCount>=0&&m.halfHalfPricing!==null&&
   m.ingredientsReviewed&&m.allergenEscalationAcknowledged,
   'Owner must review priced pizzas, combinations, half/half, ingredients and allergy escalation.');
  add('FULFILLMENT_AREAS',f.pickupEnabled||f.deliveryEnabled,
   'At least pickup or delivery must be selected.');
  add('DELIVERY_WINDOWS',f.prepMinutes>0&&
   (!f.pickupEnabled||f.pickupMinutes>0)&&
   (!f.deliveryEnabled||f.deliveryMinutes>0),
   'Prep, pickup and delivery windows must be owner-confirmed.');
  add('DELIVERY_POSTAL_COVERAGE',!f.deliveryEnabled||f.postalFees.length>0,
   'Delivery requires owner-confirmed CEP ranges, zones and prices.');
  add('PAYMENT_PREFERENCES',d.preferredPaymentMethods.length>0,
   'Owner must choose payment preferences; these do not enable credentials or collection.');
  add('STAFF_HANDOFF',d.plannedStaffRoles.includes('OWNER')&&
   (d.plannedStaffRoles.includes('ATTENDANT')||d.plannedStaffRoles.includes('MANAGER')||
    d.plannedStaffRoles.includes('OPERATOR')),
   'Owner and at least one governed operational/handoff role must be planned.');
  add('OPERATION_MODE_CHOSEN',!!record.modeDecision&&
   record.modeDecision.selectedBy.length>0,
   'Owner must explicitly choose NATIVE_OPERATIONS or INTEGRATED_OPERATIONS.');
  // Never equate an owner mode choice with a certified PDV/KDS connector.
  const now=this.clock().toISOString();
  const [profile,latestProfile,catalog,effectiveCatalog]=await Promise.all([
   this.profiles.effective(s.tenantId,s.unitId,now),
   this.profiles.latest(s.tenantId,s.unitId),
   this.catalog.latest(s.tenantId,s.unitId),
   this.catalog.effective(s.tenantId,s.unitId,now),
  ]);
  profileVersion=profile?.version??0;catalogVersion=catalog?.version??0;
  add('EFFECTIVE_PROFILE_REVISION',!!profile&&
   !!latestProfile&&latestProfile.version===profile.version,
   'Future, expired or otherwise inactive T02 profile revisions cannot authorize an owner signoff.',true);
  add('EFFECTIVE_CATALOG_REVISION',!!catalog&&
   !!effectiveCatalog&&effectiveCatalog.version===catalog.version,
   'A future or expired T03 catalog cannot authorize the current pilot.',true);
  add('PUBLISHED_BUSINESS_PROFILE',!!profile&&
   profile.capabilityRegistry.vertical==='FOOD_SERVICE'&&
   profile.identity.assistantName===d.assistantName&&
   profile.capabilityRegistry.capabilities.includes('ORDERING')&&
   profile.capabilityRegistry.capabilities.includes('PRODUCTION')&&
   (!f.deliveryEnabled||profile.capabilityRegistry.capabilities.includes('DELIVERY')),
   'T02 business capability profile must exist with the owner-chosen assistant and operations.');
  add('EXCLUSIVE_PROFILE_MODE',!!record.modeDecision&&
   profile?.capabilityRegistry.operationMode===record.modeDecision.mode,
   'Only one operational mode may be selected and aligned with the published T02 profile.',true);
  add('PUBLISHED_CATALOG_VERSION',!!catalog&&m.catalogVersion===catalog.version&&
   catalog.version>0,'Canonical T03 catalog revision must equal reviewed version.',true);
  if(catalog){
   const counts=menuCounts(catalog);
   add('PIZZA_AND_COMBO_COUNTS',counts.flavors>0&&
    counts.flavors===m.pizzaFlavorCount&&counts.combos===m.comboCount,
    'Active pizza recipes and combo count must exactly match reviewed T03 catalog.',true);
   const pizzaItems=catalog.items.filter(i=>i.active&&i.kind==='PIZZA');
   add('HALF_HALF_RULE',pizzaItems.length>0&&
    pizzaItems.every(i=>i.pizza?.halfHalfPricing===m.halfHalfPricing),
    'All offered pizzas must use the explicit owner-approved half/half pricing rule.',true);
   add('CATALOG_PRICES_COMPLETE',verifyMenuPrices(catalog),
    'Every active pizza-size pair and fixed-price item must have a positive price.',true);
   const activeZones=catalog.deliveryZones.filter(z=>z.active);
   const zoneIds=new Set(f.postalFees.map(z=>z.zoneId));
   add('ZONE_FEES_MATCH_CATALOG',!f.deliveryEnabled||
    (activeZones.length>0&&activeZones.every(z=>
      zoneIds.has(z.id)&&f.postalFees.filter(fee=>fee.zoneId===z.id)
       .every(fee=>fee.feeMinor===z.feeMinor))&&
     f.postalFees.every(fee=>activeZones.some(z=>z.id===fee.zoneId))),
    'Delivery area prices in owner review must equal the published catalog, without repricing.',true);
  }else{
   for(const code of ['PIZZA_AND_COMBO_COUNTS','HALF_HALF_RULE','CATALOG_PRICES_COMPLETE',
    'ZONE_FEES_MATCH_CATALOG'])add(code,false,'T03 catalog does not exist.');
  }
  return {checks,catalogVersion,profileVersion};
 }
 private async report(s:{tenantId:string;unitId:string},r:PilotRegistrationRecord|null):
 Promise<PilotRegistrationReport>{
  const evaluation=await this.evaluate(s,r);
  const checks=evaluation.checks;
  const hasOwnerApproval=!!r?.attestation&&r.status==='OWNER_ATTESTED'&&
   r.attestation.attestedBy.length>0&&r.attestation.recordHash===recordHash(r)&&
   r.attestation.sourceVersion===r.version-1&&
   r.attestation.catalogVersion===evaluation.catalogVersion&&
   r.attestation.profileVersion===evaluation.profileVersion;
  checks.push({code:'OWNER_SIGNOFF',
   status:hasOwnerApproval?'READY':'MISSING',
   detail:'Owner must sign the exact source revisions, values and mode using an authenticated OWNER membership. Document reference is owner-supplied, not independently authenticated.'});
  const complete=checks.every(x=>x.status==='READY');
  return {tenantId:s.tenantId,unitId:s.unitId,version:r?.version??0,
   status:complete?'OWNER_ATTESTED':'NO_GO',checks,
   selectedMode:r?.modeDecision?.mode??null,
   operationalActivationAllowed:false,
   nextGate:complete?'T08.2_REQUIRES_SEPARATE_AUTHORIZATION':'T08.1_OWNER_VALIDATION'};
 }
}
