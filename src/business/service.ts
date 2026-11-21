import { ApplicationError } from '../infrastructure/errors';
import type { TenantContext } from '../types/contracts';
import type { BusinessProfileRepository } from './contracts';
import {
  BUSINESS_CAPABILITIES,BUSINESS_VERTICALS,
  type ApprovedBusinessFact,type BusinessProfileInput,type BusinessProfileRevision,
} from './model';

export function requireBusinessScope(context:TenantContext,unitId:string):{tenantId:string;unitId:string}{
  const tenantId=context.tenantId?.trim();
  const unit=unitId?.trim();
  const valid=/^[A-Za-z0-9_-]{1,96}$/;
  if(!tenantId||!valid.test(tenantId))throw new ApplicationError({category:'FORBIDDEN',code:'BUSINESS_TENANT_INVALID',message:'Tenant authorization required.'});
  if(!unit||!valid.test(unit))throw new ApplicationError({category:'VALIDATION',code:'BUSINESS_UNIT_INVALID',message:'Unit is invalid.'});
  return {tenantId,unitId:unit};
}
export function requireBusinessAdmin(context:TenantContext):void {
  if(!context.userId?.trim()||!['OWNER','ADMIN'].includes(context.role??'')) {
    throw new ApplicationError({category:'FORBIDDEN',code:'BUSINESS_MANAGEMENT_DENIED',message:'Management permission required.'});
  }
}
export function normalizedQuestion(s:string):string{
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
    .replace(/[?!.,;:]/g,' ').replace(/\s+/g,' ').trim();
}
function fail(code:string):never {
  throw new ApplicationError({category:'VALIDATION',code,message:'Business profile data is invalid.'});
}
function field(value:unknown,max:number):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\r\n\u0000-\u001f]/.test(value))fail('BUSINESS_TEXT_INVALID');
  return (value as string).trim();
}
function iso(value:unknown):string {
  if(typeof value!=='string'||!/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value))fail('BUSINESS_DATE_INVALID');
  const date=new Date(value as string);
  if(!Number.isFinite(date.valueOf()))fail('BUSINESS_DATE_INVALID');
  return date.toISOString();
}
function validateFacts(facts:unknown):ApprovedBusinessFact[] {
  if(!Array.isArray(facts)||facts.length>50)fail('BUSINESS_FACTS_INVALID');
  const ids=new Set<string>(),questions=new Set<string>();
  return facts.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('BUSINESS_FACTS_INVALID');
    const f=raw as ApprovedBusinessFact;
    const id=field(f.id,96);
    if(!/^[a-zA-Z0-9_-]+$/.test(id)||ids.has(id))fail('BUSINESS_FACT_DUPLICATE');
    ids.add(id);
    const question=field(f.question,240);
    const key=normalizedQuestion(question);
    if(questions.has(key))fail('BUSINESS_FACT_CONTRADICTION');
    questions.add(key);
    const answer=field(f.answer,1800);
    // Money and discount claims must be read from the versioned Catalog/Order engine, never FAQ prose.
    if(/R\$\s*\d|\b\d+(?:[,.]\d+)?\s*%/.test(answer))fail('BUSINESS_MONETARY_FACT_FORBIDDEN');
    const kind=f.kind;
    if(!['FAQ','HOURS','DELIVERY','POLICY','CONTACT','GENERAL'].includes(kind))fail('BUSINESS_FACT_KIND_INVALID');
    return {id,kind,question,answer,sourceRef:field(f.sourceRef,160)};
  });
}
export class BusinessProfileService {
  constructor(private readonly repository:BusinessProfileRepository){}
  async latest(context:TenantContext,unitId:string):Promise<BusinessProfileRevision|null>{
    requireBusinessAdmin(context);
    const scope=requireBusinessScope(context,unitId);
    return this.repository.latest(scope.tenantId,scope.unitId);
  }
  async effective(context:TenantContext,unitId:string,at=new Date().toISOString()):Promise<BusinessProfileRevision|null>{
    const scope=requireBusinessScope(context,unitId);
    return this.repository.effective(scope.tenantId,scope.unitId,iso(at));
  }
  async publish(context:TenantContext,unitId:string,input:BusinessProfileInput):Promise<BusinessProfileRevision>{
    requireBusinessAdmin(context);
    const scope=requireBusinessScope(context,unitId);
    if(!input||typeof input!=='object'||!Number.isSafeInteger(input.expectedVersion)||
      input.expectedVersion<0||input.expectedVersion>100000)fail('BUSINESS_VERSION_INVALID');
    const latest=await this.repository.latest(scope.tenantId,scope.unitId);
    if((latest?.version??0)!==input.expectedVersion) {
      throw new ApplicationError({category:'CONFLICT',code:'BUSINESS_VERSION_CONFLICT',message:'Business profile was updated by another operation.'});
    }
    const effectiveFrom=iso(input.effectiveFrom);
    const expiresAt=input.expiresAt==null?undefined:iso(input.expiresAt);
    if((expiresAt&&expiresAt<=effectiveFrom)||(latest&&effectiveFrom<=latest.effectiveFrom))fail('BUSINESS_EFFECTIVE_PERIOD_INVALID');
    const identity=input.identity;
    const capability=input.capabilityRegistry;
    const policy=input.policy;
    if(!identity||!capability||!policy)fail('BUSINESS_PROFILE_INVALID');
    const assistantName=field(identity.assistantName,60);
    if(assistantName.length<2||!['PROFESSIONAL','FRIENDLY','DIRECT'].includes(identity.voiceStyle))fail('BUSINESS_IDENTITY_INVALID');
    if(!BUSINESS_VERTICALS.includes(capability.vertical)||
      !['NATIVE_OPERATIONS','INTEGRATED_OPERATIONS'].includes(capability.operationMode)||
      capability.integrationStatus!=='NOT_CONFIGURED'||
      !Array.isArray(capability.capabilities)||capability.capabilities.length>BUSINESS_CAPABILITIES.length||
      capability.capabilities.some(x=>!BUSINESS_CAPABILITIES.includes(x))||
      new Set(capability.capabilities).size!==capability.capabilities.length)fail('BUSINESS_CAPABILITIES_INVALID');
    if(!Number.isInteger(policy.memoryRetentionDays)||policy.memoryRetentionDays<1||
      policy.memoryRetentionDays>365||policy.personalMemoryDefault!=='DENY'||
      policy.prohibitUnverifiedClaims!==true||policy.locale!=='pt-BR')fail('BUSINESS_POLICY_INVALID');
    try {new Intl.DateTimeFormat('pt-BR',{timeZone:policy.timezone}).format();}catch{fail('BUSINESS_TIMEZONE_INVALID');}
    const revision:BusinessProfileRevision={
      ...scope,version:input.expectedVersion+1,effectiveFrom,
      ...(expiresAt?{expiresAt}:{}),createdAt:new Date().toISOString(),
      createdBy:context.userId!,
      identity:{assistantName,voiceStyle:identity.voiceStyle},
      capabilityRegistry:{
        vertical:capability.vertical,capabilities:[...capability.capabilities],
        operationMode:capability.operationMode,integrationStatus:'NOT_CONFIGURED',
      },
      policy:{locale:'pt-BR',timezone:policy.timezone,memoryRetentionDays:policy.memoryRetentionDays,
        personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},
      facts:validateFacts(input.facts),
    };
    await this.repository.createRevision(revision,input.expectedVersion);
    return revision;
  }
}
