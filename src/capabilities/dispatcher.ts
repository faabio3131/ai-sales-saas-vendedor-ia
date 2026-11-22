import type {TenantContext} from '../types/contracts';
import {ApplicationError} from '../infrastructure/errors';
import type {CapabilityId} from './model';
import {capabilityManifest} from './catalog';
import {CapabilityRegistryService} from './service';
export interface CapabilityInvocation {
 tenantId:string;unitId:string;userId:string;role:string;assignmentVersion:number;
}
export interface CapabilityHandler<Input=unknown,Output=unknown>{
 capability:CapabilityId;
 execute(ctx:CapabilityInvocation,input:Input):Promise<Output>;
}
/**
 * Domain-specific handlers are injected at assembly time only. No tenant-owned
 * module path, arbitrary URL, eval or dynamic code execution is supported.
 * This is a guarded execution port, not an automatic bridge into old routes.
 */
export class CapabilityDispatcher {
 private readonly handlers=new Map<CapabilityId,CapabilityHandler>();
 constructor(private readonly registry:CapabilityRegistryService,
  installed:readonly CapabilityHandler[]){
  for(const h of installed){
   if(!capabilityManifest(h.capability)||this.handlers.has(h.capability))
    throw new Error('CAPABILITY_DISPATCHER_CONFIGURATION_INVALID');
   this.handlers.set(h.capability,h);
  }
 }
 async invoke(ctx:TenantContext,unitId:string,capability:CapabilityId,input:unknown){
  const decision=await this.registry.requireInternal(ctx,unitId,capability);
  const handler=this.handlers.get(capability);
  if(!handler||!ctx.userId)
   throw new ApplicationError({category:'FORBIDDEN',
    code:'CAPABILITY_HANDLER_UNAVAILABLE',
    message:'Module not installed or authorized.'});
  return handler.execute({tenantId:decision.tenantId,unitId:decision.unitId,
   userId:ctx.userId,role:ctx.role??'',assignmentVersion:decision.assignmentVersion!},input);
 }
}
