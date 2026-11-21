import type { AIRequest } from '../ai/contracts';
import type { CommercialContext } from '../ai/cognitiveContext';
import type { TenantContext } from '../types/contracts';
import { BusinessGroundingService } from './grounding';
import { BusinessMemoryService } from './memoryService';
import { requireBusinessScope } from './service';

/**
 * Business-approved facts may enter the trusted evidence pack.
 * Customer-authored preferences are ALWAYS untrusted input, never trusted facts.
 */
export class CommercialCustomerContextService {
  constructor(private readonly grounding:BusinessGroundingService,private readonly memory:BusinessMemoryService){}
  async assemble(ctx:TenantContext,unitId:string,at?:string):Promise<CommercialContext>{
    requireBusinessScope(ctx,unitId);
    return this.grounding.evidence(ctx,unitId,at);
  }
  async aiRequest(ctx:TenantContext,unitId:string,customerId:string,input:unknown,at?:string):Promise<AIRequest>{
    const scope=requireBusinessScope(ctx,unitId);
    const [context,record]=await Promise.all([
      this.assemble(ctx,unitId,at),
      this.memory.get(ctx,unitId,customerId),
    ]);
    const untrustedInput=record?{
      request:input,
      customerMemory:{
        summary:record.summary,
        interests:record.interests,
        preferences:record.preferences,
        sourceRefs:record.sourceRefs,
        consentVersion:record.version,
      },
    }:input;
    return {tenantId:scope.tenantId,capability:'GENERAL_REASONING',input:untrustedInput,context};
  }
}
