import { Router,type Request,type Response } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import type { TenantContext } from '../types/contracts';
import type { OrderRepository,OrderConfirmationEvidence } from './model';
import type { UnitCatalogRepository } from '../commerce/model';
import type { BusinessProfileRepository } from '../business/contracts';
import type { CustomerRepository } from '../customers/contracts';
import { FirestoreUnitCatalogRepository } from '../commerce/firestoreRepository';
import type {FulfillmentSettingsRepository} from '../fulfillment/model';
import {FirestoreFulfillmentSettingsRepository} from '../fulfillment/firestoreRepository';
import { FirestoreBusinessProfileRepository } from '../business/firestoreRepository';
import { FirestoreCustomerRepository } from '../customers/firestoreRepository';
import { FirestoreConversationRepository,FirestoreMessageRepository } from '../conversations/firestoreRepository';
import { FirestoreOrderRepository } from './firestoreRepository';
import { ConversationOrderConfirmationVerifier } from './confirmationVerifier';
import { OrderService } from './service';

export interface OrderRouteDependencies {
  orders?:OrderRepository;
  catalog?:UnitCatalogRepository;
  businesses?:BusinessProfileRepository;
  customers?:CustomerRepository;
  confirmation?:OrderConfirmationEvidence;
  fulfillmentSettings?:Pick<FulfillmentSettingsRepository,'get'>;
}
function context(req:Request):TenantContext{
  if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
    code:'TENANT_CONTEXT_REQUIRED',message:'Tenant authorization is required.'});
  return req.tenantContext;
}
export function createOrdersRouter(deps:OrderRouteDependencies={}):Router{
  const router=Router();
  const service=new OrderService(
    deps.orders??new FirestoreOrderRepository(),
    deps.catalog??new FirestoreUnitCatalogRepository(),
    deps.businesses??new FirestoreBusinessProfileRepository(),
    deps.customers??new FirestoreCustomerRepository(),
    deps.confirmation??new ConversationOrderConfirmationVerifier(
      new FirestoreConversationRepository(),new FirestoreMessageRepository()),
    ()=>new Date(),
    deps.fulfillmentSettings??(deps.orders||deps.catalog||deps.businesses?
      undefined:new FirestoreFulfillmentSettingsRepository()),
  );
  router.get('/units/:unitId',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.list(context(req),req.params.unitId)});}
    catch(e){next(e);}
  });
  router.post('/units/:unitId',async(req:Request,res:Response,next)=>{
    try{res.status(201).json({ok:true,data:await service.createDraft(
      context(req),req.params.unitId,req.body)});}
    catch(e){next(e);}
  });
  router.get('/units/:unitId/:id',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.get(context(req),req.params.unitId,req.params.id)});}
    catch(e){next(e);}
  });
  router.patch('/units/:unitId/:id',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.updateDraft(
      context(req),req.params.unitId,req.params.id,req.body)});}
    catch(e){next(e);}
  });
  router.post('/units/:unitId/:id/confirm',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.confirm(
      context(req),req.params.unitId,req.params.id,req.body)});}
    catch(e){next(e);}
  });
  router.post('/units/:unitId/:id/cancel',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.cancel(
      context(req),req.params.unitId,req.params.id,req.body)});}
    catch(e){next(e);}
  });
  router.get('/units/:unitId/:id/dispatch-intent',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.dispatchIntent(
      context(req),req.params.unitId,req.params.id)});}
    catch(e){next(e);}
  });
  return router;
}
