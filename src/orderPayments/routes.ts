import { Router,type Request,type Response } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import type { TenantContext } from '../types/contracts';
import type { OrderPaymentService } from './service';
import { createOrderPaymentRuntime } from './runtime';

function context(req:Request):TenantContext{
  if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
    code:'ORDER_PAYMENT_TENANT_REQUIRED',message:'Authenticated tenant required.'});
  return req.tenantContext;
}
export function createOrderPaymentsRouter(service:OrderPaymentService=createOrderPaymentRuntime().service):Router{
  const router=Router();
  router.get('/units/:unitId/orders/:orderId',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.get(context(req),req.params.unitId,req.params.orderId)});}
    catch(error){next(error);}
  });
  router.post('/units/:unitId/orders/:orderId',async(req:Request,res:Response,next)=>{
    try{res.status(201).json({ok:true,data:await service.create(context(req),
      req.params.unitId,req.params.orderId,req.body)});}
    catch(error){next(error);}
  });
  router.post('/units/:unitId/orders/:orderId/recover',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.recoverUnknown(context(req),
      req.params.unitId,req.params.orderId,req.body)});}
    catch(error){next(error);}
  });
  router.post('/units/:unitId/payments/:id/refresh',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.refresh(context(req),req.params.unitId,req.params.id)});}
    catch(error){next(error);}
  });
  router.post('/units/:unitId/orders/:orderId/collect',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.collect(context(req),
      req.params.unitId,req.params.orderId,req.body)});}
    catch(error){next(error);}
  });
  router.post('/units/:unitId/orders/:orderId/refund',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await service.refund(context(req),
      req.params.unitId,req.params.orderId,req.body)});}
    catch(error){next(error);}
  });
  return router;
}
