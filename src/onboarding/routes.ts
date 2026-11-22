import {Router,type Request} from 'express';
import {reject} from '../scheduling/rules';
import {MultiSectorOnboarding} from './service';
import {FirestoreMultiSectorOnboarding} from './firestoreRepository';
function ctx(req:Request){if(!req.tenantContext)return reject('ONBOARDING_TENANT_REQUIRED','FORBIDDEN');return req.tenantContext;}
export function createMultiSectorOnboardingRouter(service=new MultiSectorOnboarding(new FirestoreMultiSectorOnboarding())){
 const r=Router(),base='/units/:unitId';
 r.get(base+'/templates',(req,res,next)=>{try{res.json({ok:true,data:service.templates(ctx(req),req.params.unitId)});}catch(e){next(e);}});
 r.get(base,async(req,res,next)=>{try{res.json({ok:true,data:await service.get(ctx(req),req.params.unitId)});}catch(e){next(e);}});
 r.post(base,async(req,res,next)=>{try{res.status(201).json({ok:true,data:await service.create(ctx(req),req.params.unitId,req.body)});}catch(e){next(e);}});
 return r;
}
