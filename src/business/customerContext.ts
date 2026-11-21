import type { AIRequest } from '../ai/contracts';
import type { CommercialContext,CommercialEvidence } from '../ai/cognitiveContext';
import type { TenantContext } from '../types/contracts';
import { redactCommercialText } from '../ai/cognitiveContext';
import { BusinessGroundingService } from './grounding';
import { BusinessMemoryService } from './memoryService';
import { requireBusinessScope } from './service';

/**
 * Join only versioned, approved business facts with explicitly consented,
 * unexpired, customer-scoped memory. Does not make purchases or send messages.
 */
export class CommercialCustomerContextService {
  constructor(private readonly grounding:BusinessGroundingService,private readonly memory:BusinessMemoryService){}
  async assemble(ctx:TenantContext,unitId:string,customerId:string,at?:string):Promise<CommercialContext>{
    const scope=requireBusinessScope(ctx,unitId);
    const business=await this.grounding.evidence(ctx,unitId,at);
    const record=await this.memory.get(ctx,unitId,customerId);
    if(!record||business.evidence.length>=16)return business;
    const parts=[
      record.summary.trim()? 'Resumo: '+record.summary.trim() : '',
      record.interests.length?'Interesses: '+record.interests.join('; '):'',
      record.preferences.length?'Preferências: '+record.preferences.join('; '):'',
    ].filter(Boolean);
    if(!parts.length)return business;
    const sourceReferences=record.sourceRefs.map(x=>redactCommercialText(x)).join(', ').slice(0,180);
    const evidence:CommercialEvidence={
      id:'memory:'+record.version,
      tenantId:scope.tenantId,unitId:scope.unitId,origin:'consented:'+sourceReferences,
      body:redactCommercialText(parts.join(' | ')).slice(0,1024),
      trusted:true,
    };
    return {unitId:scope.unitId,evidence:[...business.evidence,evidence]};
  }
  async aiRequest(ctx:TenantContext,unitId:string,customerId:string,input:unknown,at?:string):Promise<AIRequest>{
    const scope=requireBusinessScope(ctx,unitId);
    return {tenantId:scope.tenantId,capability:'GENERAL_REASONING',input,
      context:await this.assemble(ctx,unitId,customerId,at)};
  }
}
