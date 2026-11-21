import { Router,type Request,type Response } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import type { TenantContext } from '../types/contracts';
import type { UnitCatalogRepository } from './model';
import type { BusinessProfileRepository } from '../business/contracts';
import { FirestoreBusinessProfileRepository } from '../business/firestoreRepository';
import { FirestoreUnitCatalogRepository } from './firestoreRepository';
import { UnitCatalogService } from './service';

function context(req:Request):TenantContext {
  if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
    code:'TENANT_CONTEXT_REQUIRED',message:'Tenant authorization is required.'});
  return req.tenantContext;
}
export function createCommerceRouter(
  repository:UnitCatalogRepository=new FirestoreUnitCatalogRepository(),
  businesses:BusinessProfileRepository=new FirestoreBusinessProfileRepository(),
):Router {
  const router=Router();
  const service=new UnitCatalogService(repository,businesses);
  router.get('/units/:unitId/catalog',async(req:Request,res:Response,next)=>{
    try{res.status(200).json({ok:true,data:await service.effective(context(req),req.params.unitId)});}
    catch(e){next(e);}
  });
  router.get('/units/:unitId/catalog/latest',async(req:Request,res:Response,next)=>{
    try{res.status(200).json({ok:true,data:await service.latest(context(req),req.params.unitId)});}
    catch(e){next(e);}
  });
  router.post('/units/:unitId/catalog/revisions',async(req:Request,res:Response,next)=>{
    try{res.status(201).json({ok:true,data:await service.publish(context(req),req.params.unitId,req.body)});}
    catch(e){next(e);}
  });
  return router;
}
