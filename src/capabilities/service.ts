import {ApplicationError} from '../infrastructure/errors';
import type {TenantContext} from '../types/contracts';
import type {BusinessProfileRepository} from '../business/contracts';
import type {BusinessProfileRevision,BusinessCapability} from '../business/model';
import {requireBusinessAdmin,requireBusinessScope} from '../business/service';
import {capabilityManifest,capabilityTemplate,listCapabilityManifests,
 listCapabilityTemplates,templateForVertical} from './catalog';
import type {CapabilityId,CapabilityAssignment,CapabilityPublishInput,
 CapabilityRollbackInput,CapabilityResolution,CapabilityRepository,
 CapabilityTemplateId} from './model';

const forbidden=(code:string):never=>{throw new ApplicationError({
 category:'FORBIDDEN',code,message:'Capability assignment is not authorized.',
});};
const invalid=(code:string):never=>{throw new ApplicationError({
 category:'VALIDATION',code,message:'Invalid capability selection.',
});};
const conflict=(code:string):never=>{throw new ApplicationError({
 category:'CONFLICT',code,message:'Capability assignment requires reconciliation.',
});};
const notFound=(code:string):never=>{throw new ApplicationError({
 category:'NOT_FOUND',code,message:'Requested capability version was not found.',
});};
function reader(ctx:TenantContext,unitId:string){
 if(!ctx.userId?.trim()||!['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT',
  'STAFF','VIEWER','CASHIER'].includes(ctx.role??''))
  forbidden('CAPABILITY_MEMBER_REQUIRED');
 return requireBusinessScope(ctx,unitId);
}
function keys(raw:unknown,allowed:string[]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.getPrototypeOf(raw)!==Object.prototype||
   Object.keys(raw).some(k=>!allowed.includes(k)))invalid('CAPABILITY_FIELDS_INVALID');
}
function version(value:unknown,allowZero:boolean):number{
 if(!Number.isSafeInteger(value)||Number(value)<(allowZero?0:1)||Number(value)>100000)
  invalid('CAPABILITY_VERSION_INVALID');
 return Number(value);
}
function reason(value:unknown):string{
 if(typeof value!=='string'||value.trim().length<8||value.trim().length>240||
  /[\u0000-\u001f]/.test(value))invalid('CAPABILITY_REASON_INVALID');
 return value.trim();
}
/** Legacy food feature flags are independently enforced: new registry cannot grant them. */
const legacyFood:Partial<Record<CapabilityId,readonly BusinessCapability[]>>={
 FOOD_ORDERING:['FOOD_SERVICE','ORDERING'],
 FOOD_PRODUCTION:['FOOD_SERVICE','ORDERING','PRODUCTION'],
 FOOD_DELIVERY:['FOOD_SERVICE','ORDERING','DELIVERY'],
 FOOD_FINANCE:['FOOD_SERVICE','ORDERING'],
};
function legacyCompatible(id:CapabilityId,profile:BusinessProfileRevision){
 const required=legacyFood[id]??[];
 return required.every(cap=>profile.capabilityRegistry.capabilities.includes(cap));
}
export class CapabilityRegistryService {
 constructor(private readonly store:CapabilityRepository,
  private readonly profiles:BusinessProfileRepository,
  private readonly clock:()=>Date=()=>new Date()){}
 catalog(ctx:TenantContext,unitId:string){
  reader(ctx,unitId);
  return {schemaVersion:1,manifests:listCapabilityManifests(),
   templates:listCapabilityTemplates(),commercialGoLiveAuthorized:false};
 }
 async latest(ctx:TenantContext,unitId:string){
  const s=reader(ctx,unitId);return this.store.latest(s.tenantId,s.unitId);
 }
 async getVersion(ctx:TenantContext,unitId:string,rawVersion:unknown){
  requireBusinessAdmin(ctx);
  const s=reader(ctx,unitId),v=version(rawVersion,false);
  const row=await this.store.version(s.tenantId,s.unitId,v);
  if(!row)notFound('CAPABILITY_REVISION_NOT_FOUND');
  return row!;
 }
 private async profile(t:string,u:string,now:string){
  const [latest,effective]=await Promise.all([
   this.profiles.latest(t,u),this.profiles.effective(t,u,now)
  ]);
  if(!latest||!effective||latest.tenantId!==t||latest.unitId!==u||
    effective.tenantId!==t||effective.unitId!==u||effective.version!==latest.version)
   conflict('CAPABILITY_CURRENT_PROFILE_REQUIRED');
  return latest!;
 }
 private validateSelection(input:CapabilityPublishInput,profile:BusinessProfileRevision){
  const template=capabilityTemplate(input.templateId);
  if(!template||input.templateVersion!==1)invalid('CAPABILITY_TEMPLATE_UNKNOWN');
  if(template.vertical!==profile.capabilityRegistry.vertical)
   conflict('CAPABILITY_VERTICAL_MISMATCH');
  if(!Array.isArray(input.enabledCapabilities)||input.enabledCapabilities.length>32)
   invalid('CAPABILITY_SELECTION_INVALID');
  const enabled:CapabilityId[]=[];
  for(const selected of input.enabledCapabilities){
   if(typeof selected!=='string'||!template.capabilities.includes(selected))
    invalid('CAPABILITY_NOT_IN_TEMPLATE');
   if(enabled.includes(selected))invalid('CAPABILITY_DUPLICATE_SELECTION');
   const module=capabilityManifest(selected);
   if(!module||module.maturity!=='READY_INTERNAL')
    conflict('CAPABILITY_NOT_IMPLEMENTED');
   if(!legacyCompatible(selected,profile))
    conflict('CAPABILITY_LEGACY_POLICY_DENIED');
   enabled.push(selected);
  }
  for(const selected of enabled){
   const module=capabilityManifest(selected)!;
   for(const dependency of module.dependsOn)
    if(!enabled.includes(dependency))
     invalid('CAPABILITY_DEPENDENCY_MISSING');
  }
  return {template,enabled:enabled.sort(),
   pending:template.capabilities.filter(c=>capabilityManifest(c)!.maturity==='PLANNED')};
 }
 private async append(ctx:TenantContext,unitId:string,input:CapabilityPublishInput,
  rollbackOfVersion?:number):Promise<CapabilityAssignment>{
  requireBusinessAdmin(ctx);
  const s=reader(ctx,unitId);
  keys(input,['expectedVersion','templateId','templateVersion','enabledCapabilities','reason']);
  const expected=version(input.expectedVersion,true);
  const [previous,profile]=await Promise.all([
   this.store.latest(s.tenantId,s.unitId),
   this.profile(s.tenantId,s.unitId,this.clock().toISOString()),
  ]);
  if((previous?.version??0)!==expected)conflict('CAPABILITY_VERSION_CONFLICT');
  const selected=this.validateSelection(input,profile);
  const next:CapabilityAssignment={
   schemaVersion:1,...s,version:expected+1,
   templateId:selected.template.id,templateVersion:1,vertical:selected.template.vertical,
   enabledCapabilities:selected.enabled,pendingCapabilities:[...selected.pending],
   state:selected.enabled.length?'ENABLED_INTERNAL':'DISABLED',
   operationMode:profile.capabilityRegistry.operationMode,profileVersion:profile.version,
   createdAt:this.clock().toISOString(),createdBy:ctx.userId!,
   reason:reason(input.reason),
   ...(rollbackOfVersion!==undefined?{rollbackOfVersion}:{}),
  };
  await this.store.publish(next,expected);
  return next;
 }
 async publish(ctx:TenantContext,unitId:string,raw:unknown){
  keys(raw,['expectedVersion','templateId','templateVersion','enabledCapabilities','reason']);
  return this.append(ctx,unitId,raw as CapabilityPublishInput);
 }
 async provisionDefaults(ctx:TenantContext,unitId:string,input:unknown){
  keys(input,['expectedVersion','reason']);
  const p=input as {expectedVersion:unknown;reason:unknown};
  requireBusinessAdmin(ctx);
  const s=reader(ctx,unitId);
  const profile=await this.profile(s.tenantId,s.unitId,this.clock().toISOString());
  const template=templateForVertical(profile.capabilityRegistry.vertical);
  if(!template)invalid('CAPABILITY_TEMPLATE_UNKNOWN');
  return this.append(ctx,unitId,{
   expectedVersion:version(p.expectedVersion,true),
   templateId:template.id,templateVersion:1,
   enabledCapabilities:[...template.defaultEnabled],reason:reason(p.reason),
  });
 }
 async rollback(ctx:TenantContext,unitId:string,raw:unknown){
  keys(raw,['expectedVersion','restoreVersion','reason']);
  requireBusinessAdmin(ctx);
  const s=reader(ctx,unitId),p=raw as CapabilityRollbackInput;
  const expected=version(p.expectedVersion,true);
  const restore=version(p.restoreVersion,false);
  if(restore>=expected)invalid('CAPABILITY_ROLLBACK_TARGET_INVALID');
  const historical=await this.store.version(s.tenantId,s.unitId,restore);
  if(!historical)notFound('CAPABILITY_REVISION_NOT_FOUND');
  return this.append(ctx,unitId,{
   expectedVersion:expected,templateId:historical!.templateId,templateVersion:1,
   enabledCapabilities:[...historical!.enabledCapabilities],
   reason:reason(p.reason),
  },restore);
 }
 async resolve(ctx:TenantContext,unitId:string,rawCapability:unknown):Promise<CapabilityResolution>{
  const s=reader(ctx,unitId);
  if(typeof rawCapability!=='string'||!capabilityManifest(rawCapability as CapabilityId))
   invalid('CAPABILITY_UNKNOWN');
  const capability=rawCapability as CapabilityId;
  const [current,profile]=await Promise.all([
   this.store.latest(s.tenantId,s.unitId),
   this.profiles.effective(s.tenantId,s.unitId,this.clock().toISOString()),
  ]);
  const base={...s,capability,commercialGoLiveAuthorized:false as const};
  if(!profile)return {...base,authorized:false,status:'PROFILE_UNAVAILABLE' as const};
  if(!current)return {...base,authorized:false,status:'NOT_CONFIGURED' as const};
  const details={assignmentVersion:current.version,templateId:current.templateId};
  const template=capabilityTemplate(current.templateId);
  if(!template||template.vertical!==profile.capabilityRegistry.vertical||
    current.vertical!==profile.capabilityRegistry.vertical||
    current.operationMode!==profile.capabilityRegistry.operationMode||
    current.templateVersion!==1)
   return {...base,...details,authorized:false,status:'TEMPLATE_MISMATCH' as const};
  if(!template.capabilities.includes(capability))
   return {...base,...details,authorized:false,status:'NOT_ENABLED' as const};
  if(capabilityManifest(capability)!.maturity!=='READY_INTERNAL')
   return {...base,...details,authorized:false,status:'FUTURE_IMPLEMENTATION' as const};
  if(current.state==='DISABLED')
   return {...base,...details,authorized:false,status:'DISABLED' as const};
  if(!current.enabledCapabilities.includes(capability))
   return {...base,...details,authorized:false,status:'NOT_ENABLED' as const};
  if(!legacyCompatible(capability,profile))
   return {...base,...details,authorized:false,status:'TEMPLATE_MISMATCH' as const};
  return {...base,...details,authorized:true,status:'ALLOWED_INTERNAL' as const};
 }
 async requireInternal(ctx:TenantContext,unitId:string,capability:CapabilityId){
  const decision=await this.resolve(ctx,unitId,capability);
  if(!decision.authorized)forbidden('CAPABILITY_EXECUTION_NOT_AUTHORIZED');
  return decision;
 }
}
