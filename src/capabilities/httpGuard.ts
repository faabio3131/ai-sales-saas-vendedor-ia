import type {RequestHandler} from 'express';
import type {CapabilityId} from './model';
import {ApplicationError} from '../infrastructure/errors';
import {CapabilityRegistryService} from './service';
import {FirestoreCapabilityRepository} from './firestoreRepository';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';

/**
 * Additional API perimeter control. Existing T02/T03/T04/T05/T06/RBAC
 * checks still apply. Any missing T09 assignment fails closed.
 * Does not block background settlement/reconciliation of existing payments.
 */
export function capabilityHttpGate(
 capability:CapabilityId,
 registry:Pick<CapabilityRegistryService,'requireInternal'>=
 new CapabilityRegistryService(new FirestoreCapabilityRepository(),
  new FirestoreBusinessProfileRepository()),
):RequestHandler{
 return (req,_res,next)=>{
  const ctx=req.tenantContext;
  const path=/^\/units\/([A-Za-z0-9_-]{1,96})(?:\/|$)/.exec(req.path);
  if(!ctx||!path){
   next(new ApplicationError({category:'FORBIDDEN',
    code:'CAPABILITY_SCOPE_REQUIRED',message:'Authenticated unit scope required.'}));
   return;
  }
  void registry.requireInternal(ctx,path[1],capability)
   .then(()=>next()).catch(next);
 };
}
