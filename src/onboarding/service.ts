import {createHash} from 'node:crypto';
import {BusinessProfileService,requireBusinessAdmin,requireBusinessScope} from '../business/service';
import type {BusinessProfileRepository} from '../business/contracts';
import type {BusinessProfileInput,BusinessProfileRevision,OperationMode} from '../business/model';
import type {CapabilityAssignment,CapabilityId} from '../capabilities/model';
import {capabilityManifest,capabilityTemplate} from '../capabilities/catalog';
import type {TenantContext} from '../types/contracts';
import {object,id,integer,reject,reason,zone} from '../scheduling/rules';
import type {OnboardingStore,OnboardingTemplate} from './model';
const core:CapabilityId[]=['CORE_KNOWLEDGE','CORE_CUSTOMERS'];
const templates:OnboardingTemplate[]=[
 {id:'restaurant',label:'Restaurante / alimentação',vertical:'FOOD_SERVICE',templateId:'FOOD_SERVICE_STD',native:[...core,'FOOD_ORDERING','FOOD_PRODUCTION','FOOD_DELIVERY','FOOD_FINANCE'],integrated:core},
 {id:'retail',label:'Comércio / varejo',vertical:'RETAIL',templateId:'RETAIL_STD',native:[...core,'RETAIL_CATALOG','RETAIL_CHECKOUT','RETAIL_INVENTORY'],integrated:[...core,'RETAIL_CATALOG']},
 {id:'services',label:'Serviços profissionais',vertical:'SERVICES',templateId:'SERVICES_STD',native:[...core,'SERVICE_CATALOG','SCHEDULING','SERVICE_BOOKING'],integrated:core},
 {id:'salon',label:'Salão de beleza',vertical:'BEAUTY',templateId:'BEAUTY_STD',native:[...core,'SERVICE_CATALOG','SCHEDULING','BEAUTY_SERVICES','BEAUTY_BOOKING'],integrated:core},
 {id:'barbershop',label:'Barbearia',vertical:'BEAUTY',templateId:'BEAUTY_STD',native:[...core,'SERVICE_CATALOG','SCHEDULING','BEAUTY_SERVICES','BEAUTY_BOOKING'],integrated:core},
 {id:'aesthetics',label:'Estética (administrativo)',vertical:'HEALTH_SERVICE',templateId:'HEALTH_ADMIN_STD',native:[...core,'SERVICE_CATALOG','SCHEDULING','HEALTH_ADMIN'],integrated:core},
 {id:'general',label:'Outros segmentos',vertical:'OTHER',templateId:'GENERAL_STD',native:core,integrated:core},
];
export const onboardingTemplates=()=>structuredClone(templates);
function str(v:unknown,max:number){if(typeof v!=='string'||v.trim().length<2||v.trim().length>max||/[\u0000-\u001f]/.test(v))return reject('ONBOARDING_TEXT_INVALID');return v.trim();}
export class MultiSectorOnboarding{
 constructor(private readonly store:OnboardingStore,private readonly clock:()=>Date=()=>new Date()){}
 templates(ctx:TenantContext,u:string){requireBusinessAdmin(ctx);requireBusinessScope(ctx,u);return onboardingTemplates();}
 async get(ctx:TenantContext,u:string){requireBusinessAdmin(ctx);const s=requireBusinessScope(ctx,u);return this.store.get(s.tenantId,s.unitId);}
 async create(ctx:TenantContext,u:string,raw:unknown){
  requireBusinessAdmin(ctx);const s=requireBusinessScope(ctx,u),a=object(raw,['templateId','mode','businessName','assistantName','timezone','memoryRetentionDays','contact','address','hours','reason']);
  const selected=templates.find(x=>x.id===id(a.templateId));if(!selected)return reject('ONBOARDING_TEMPLATE_UNKNOWN');
  if(a.mode!=='NATIVE_OPERATIONS'&&a.mode!=='INTEGRATED_OPERATIONS')return reject('ONBOARDING_MODE_INVALID');
  const mode:OperationMode=a.mode,businessName=str(a.businessName,120),assistantName=str(a.assistantName,60),timezone=zone(a.timezone),memoryRetentionDays=integer(a.memoryRetentionDays,1,365);
  const contact=str(a.contact,160),address=str(a.address,240),hours=str(a.hours,400),why=reason(a.reason);
  const fingerprint=createHash('sha256').update(JSON.stringify([selected.id,mode,businessName,assistantName,timezone,memoryRetentionDays,contact,address,hours,why])).digest('hex');
  const when=this.clock().toISOString(),legacy=selected.vertical==='FOOD_SERVICE'&&mode==='NATIVE_OPERATIONS'?['FOOD_SERVICE','ORDERING','PRODUCTION','DELIVERY'] as const:[];
  const input:BusinessProfileInput={expectedVersion:0,effectiveFrom:when,identity:{assistantName,voiceStyle:'FRIENDLY'},
   capabilityRegistry:{vertical:selected.vertical,capabilities:[...legacy],operationMode:mode,integrationStatus:'NOT_CONFIGURED'},
   policy:{locale:'pt-BR',timezone,memoryRetentionDays,personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},
   facts:[{id:'business_name',kind:'GENERAL',question:'Qual o nome do estabelecimento?',answer:businessName,sourceRef:'owner-onboarding'},
    {id:'contact',kind:'CONTACT',question:'Qual o contato do estabelecimento?',answer:contact,sourceRef:'owner-onboarding'},
    {id:'address',kind:'CONTACT',question:'Qual o endereço do estabelecimento?',answer:address,sourceRef:'owner-onboarding'},
    {id:'hours',kind:'HOURS',question:'Qual o horário de funcionamento?',answer:hours,sourceRef:'owner-onboarding'}]};
  // Reuse the canonical profile validator with an isolated construction port;
  // actual writes occur only in the atomic onboarding store.
  let validated:BusinessProfileRevision|undefined;
  const view:BusinessProfileRepository={latest:async()=>null,effective:async()=>null,createRevision:async p=>{validated=p;}};
  await new BusinessProfileService(view).publish(ctx,s.unitId,input);
  if(!validated)return reject('ONBOARDING_PROFILE_INVALID','INTERNAL');
  const profile:BusinessProfileRevision=validated;
  const enabled=[...(mode==='NATIVE_OPERATIONS'?selected.native:selected.integrated)].sort();
  const template=capabilityTemplate(selected.templateId);
  if(!template||enabled.some(c=>!template.capabilities.includes(c)||capabilityManifest(c)?.maturity!=='READY_INTERNAL'||capabilityManifest(c)?.dependsOn.some(d=>!enabled.includes(d))))return reject('ONBOARDING_SCHEMA_INVALID','INTERNAL');
  const assignment:CapabilityAssignment={...s,schemaVersion:1,version:1,templateId:selected.templateId,templateVersion:1,vertical:selected.vertical,
   enabledCapabilities:enabled,pendingCapabilities:template.capabilities.filter(c=>capabilityManifest(c)?.maturity==='PLANNED'),state:'ENABLED_INTERNAL',
   operationMode:mode,profileVersion:1,createdAt:when,createdBy:ctx.userId!,reason:why};
  return this.store.create({...s,templateId:selected.id,mode,fingerprint,profile,assignment,createdAt:when,createdBy:ctx.userId!,commercialGoLiveAuthorized:false});
 }
}
