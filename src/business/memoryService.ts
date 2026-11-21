import { ApplicationError } from '../infrastructure/errors';
import type { CustomerRepository } from '../customers/contracts';
import type { TenantContext } from '../types/contracts';
import { redactCommercialText } from '../ai/cognitiveContext';
import type { BusinessProfileRepository,ScopedMemoryRepository } from './contracts';
import type { ScopedCustomerMemory,UpdateScopedMemoryInput,ChangeMemoryConsentInput } from './memoryModel';
import { requireBusinessScope,requireBusinessAdmin } from './service';

export interface MemorySourceVerifier {
  verifyCustomerEvidence(tenantId:string,customerId:string,sourceRef:string):Promise<boolean>;
}
function denied(code:string):never {
  throw new ApplicationError({category:'FORBIDDEN',code,message:'Business memory access denied.'});
}
function invalid(code:string):never {
  throw new ApplicationError({category:'VALIDATION',code,message:'Invalid customer memory input.'});
}
function optionalItems(raw:unknown,maxCount:number,maxLength:number):string[]{
  if(!Array.isArray(raw)||raw.length>maxCount)invalid('MEMORY_ITEMS_INVALID');
  const out:string[]=[];
  for(const item of raw){
    if(typeof item!=='string'||!item.trim()||item.length>maxLength)invalid('MEMORY_ITEMS_INVALID');
    const sanitized=redactCommercialText(item.trim());
    if(!out.includes(sanitized))out.push(sanitized);
  }
  return out;
}
function expiresAt(now:string,days:number):string {
  return new Date(new Date(now).valueOf()+days*86400000).toISOString();
}
export class BusinessMemoryService {
  constructor(
    private readonly customers:CustomerRepository,
    private readonly profiles:BusinessProfileRepository,
    private readonly memory:ScopedMemoryRepository,
    private readonly sources:MemorySourceVerifier,
    private readonly clock:()=>Date=()=>new Date(),
  ){}
  private async scope(ctx:TenantContext,unitId:string,customerId:string){
    requireBusinessAdmin(ctx);
    const scope=requireBusinessScope(ctx,unitId);
    if(!customerId||customerId.length>128)invalid('MEMORY_CUSTOMER_INVALID');
    const customer=await this.customers.findById(scope.tenantId,customerId);
    if(!customer)throw new ApplicationError({category:'NOT_FOUND',code:'CUSTOMER_NOT_FOUND',message:'Customer not found.'});
    const now=this.clock().toISOString();
    const profile=await this.profiles.effective(scope.tenantId,scope.unitId,now);
    if(!profile)denied('MEMORY_POLICY_NOT_ACTIVE');
    return {...scope,customerId,now,policy:profile!.policy};
  }
  private visible(record:ScopedCustomerMemory|null,now:string,days:number):ScopedCustomerMemory|null {
    if(!record||record.status!=='GRANTED'||record.expiresAt<=now||
      expiresAt(record.updatedAt,days)<=now)return null;
    return record;
  }
  async get(ctx:TenantContext,unitId:string,customerId:string):Promise<ScopedCustomerMemory|null>{
    const s=await this.scope(ctx,unitId,customerId);
    return this.visible(await this.memory.get(s.tenantId,s.unitId,s.customerId),s.now,s.policy.memoryRetentionDays);
  }
  async changeConsent(ctx:TenantContext,unitId:string,customerId:string,input:ChangeMemoryConsentInput):Promise<ScopedCustomerMemory>{
    const s=await this.scope(ctx,unitId,customerId);
    if(!input||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||typeof input.grant!=='boolean')
      invalid('MEMORY_VERSION_INVALID');
    const old=await this.memory.get(s.tenantId,s.unitId,s.customerId);
    if((old?.version??0)!==input.expectedVersion) {
      throw new ApplicationError({category:'CONFLICT',code:'MEMORY_VERSION_CONFLICT',message:'Customer memory changed concurrently.'});
    }
    let sourceRef:string|undefined;
    if(input.grant){
      if(typeof input.consentEvidenceRef!=='string'||!input.consentEvidenceRef.trim()||
        input.consentEvidenceRef.length>220)invalid('MEMORY_CONSENT_EVIDENCE_REQUIRED');
      sourceRef=input.consentEvidenceRef.trim();
      if(!(await this.sources.verifyCustomerEvidence(s.tenantId,s.customerId,sourceRef)))
        denied('MEMORY_CONSENT_EVIDENCE_UNVERIFIED');
    }
    const next:ScopedCustomerMemory={
      tenantId:s.tenantId,unitId:s.unitId,customerId:s.customerId,
      version:input.expectedVersion+1,status:input.grant?'GRANTED':'REVOKED',
      ...(sourceRef?{consentEvidenceRef:sourceRef,consentAt:s.now}:{}),
      summary:'',interests:[],preferences:[],sourceRefs:[],
      updatedAt:s.now,expiresAt:input.grant?expiresAt(s.now,s.policy.memoryRetentionDays):s.now,
      updatedBy:ctx.userId!,
    };
    await this.memory.save(next,input.expectedVersion);
    return next;
  }
  async remember(ctx:TenantContext,unitId:string,customerId:string,input:UpdateScopedMemoryInput):Promise<ScopedCustomerMemory>{
    const s=await this.scope(ctx,unitId,customerId);
    const old=await this.memory.get(s.tenantId,s.unitId,s.customerId);
    if(!old||!this.visible(old,s.now,s.policy.memoryRetentionDays))denied('MEMORY_CONSENT_REQUIRED');
    if(!input||input.expectedVersion!==old.version||!Number.isSafeInteger(input.expectedVersion))
      throw new ApplicationError({category:'CONFLICT',code:'MEMORY_VERSION_CONFLICT',message:'Customer memory changed concurrently.'});
    if(typeof input.summary!=='string'||input.summary.length>1200)invalid('MEMORY_SUMMARY_INVALID');
    const references=optionalItems(input.sourceRefs,12,220);
    if(!references.length)invalid('MEMORY_PROVENANCE_REQUIRED');
    for(const source of references){
      if(!(await this.sources.verifyCustomerEvidence(s.tenantId,s.customerId,source)))
        denied('MEMORY_SOURCE_UNVERIFIED');
    }
    const next:ScopedCustomerMemory={
      ...old,version:old.version+1,summary:redactCommercialText(input.summary.trim()),
      interests:optionalItems(input.interests??[],12,100),
      preferences:optionalItems(input.preferences??[],12,100),
      sourceRefs:references,updatedAt:s.now,
      expiresAt:expiresAt(s.now,s.policy.memoryRetentionDays),
      updatedBy:ctx.userId!,
    };
    await this.memory.save(next,old.version);
    return next;
  }
  async forget(ctx:TenantContext,unitId:string,customerId:string,expectedVersion:number):Promise<void>{
    const s=await this.scope(ctx,unitId,customerId);
    const existing=await this.memory.get(s.tenantId,s.unitId,s.customerId);
    if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||expectedVersion!==(existing?.version??0))
      throw new ApplicationError({category:'CONFLICT',code:'MEMORY_VERSION_CONFLICT',message:'Customer memory changed concurrently.'});
    await this.memory.delete(s.tenantId,s.unitId,s.customerId,expectedVersion);
  }
}
