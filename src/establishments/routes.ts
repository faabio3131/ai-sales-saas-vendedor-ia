import {Router,type Request,type Response} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';
import {FirestoreUnitCatalogRepository} from '../commerce/firestoreRepository';
import {FirestorePilotRegistrationRepository} from '../pilot/onboarding/firestoreRepository';
import {PilotRegistrationService} from '../pilot/onboarding/service';

/**
 * Generic per-tenant/per-unit establishment configuration API.
 * Shares the versioned onboarding records with the legacy T08 pilot routes:
 * no duplicated customer data or separate source of truth.
 * Mounted ONLY after authentication and verified tenant membership.
 */
function context(req:Request){
 if(!req.tenantContext)throw new ApplicationError({
  category:'FORBIDDEN',code:'TENANT_CONTEXT_REQUIRED',message:'Authorized tenant context required.',
 });
 return req.tenantContext;
}

export function createEstablishmentSettingsRouter(
 service:PilotRegistrationService=new PilotRegistrationService(
  new FirestorePilotRegistrationRepository(),
  new FirestoreBusinessProfileRepository(),new FirestoreUnitCatalogRepository(),
 )):Router{
 const router=Router();
 router.get('/units/:unitId/configuration',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.get(context(req),req.params.unitId)});}
  catch(error){next(error);}
 });
 router.put('/units/:unitId/configuration',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.saveDraft(context(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 router.post('/units/:unitId/operation-mode',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.selectMode(context(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 router.post('/units/:unitId/owner-approval',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.attest(context(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 return router;
}
