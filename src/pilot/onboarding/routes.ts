import {Router,type Request,type Response} from 'express';
import {ApplicationError} from '../../infrastructure/errors';
import {FirestoreBusinessProfileRepository} from '../../business/firestoreRepository';
import {FirestoreUnitCatalogRepository} from '../../commerce/firestoreRepository';
import {FirestorePilotRegistrationRepository} from './firestoreRepository';
import {PilotRegistrationService} from './service';

function ctx(req:Request){
 if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
  code:'PILOT_TENANT_CONTEXT_REQUIRED',message:'Authorized tenant required.'});
 return req.tenantContext;
}
export function createPilotOnboardingRouter(
 service:PilotRegistrationService=new PilotRegistrationService(
  new FirestorePilotRegistrationRepository(),
  new FirestoreBusinessProfileRepository(),new FirestoreUnitCatalogRepository(),
 )):Router{
 const router=Router();
 router.get('/units/:unitId/onboarding',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.get(ctx(req),req.params.unitId)});}catch(error){next(error);}
 });
 router.put('/units/:unitId/onboarding/draft',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.saveDraft(ctx(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 router.post('/units/:unitId/onboarding/mode',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.selectMode(ctx(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 router.post('/units/:unitId/onboarding/attest',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.attest(ctx(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 return router;
}
