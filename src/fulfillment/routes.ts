import {Router,type Request,type Response} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import type {TenantContext} from '../types/contracts';
import {createFulfillmentRuntime} from './runtime';
import type {FulfillmentService} from './service';
function ctx(req:Request):TenantContext{
 if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
   code:'FULFILLMENT_TENANT_REQUIRED',message:'Active tenant membership required.'});
 return req.tenantContext;
}
export function createFulfillmentRouter(service:FulfillmentService=createFulfillmentRuntime().service):Router{
 const router=Router();
 router.get('/units/:unitId/settings',async(req:Request,res:Response,next)=>{
  try{res.status(200).json({ok:true,data:await service.settings(ctx(req),req.params.unitId)});}
  catch(e){next(e);}
 });
 router.put('/units/:unitId/settings',async(req:Request,res:Response,next)=>{
  try{res.status(200).json({ok:true,data:await service.publishSettings(ctx(req),
    req.params.unitId,req.body)});}catch(e){next(e);}
 });
 router.get('/units/:unitId/queue',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.list(ctx(req),req.params.unitId)});}
  catch(e){next(e);}
 });
 router.get('/units/:unitId/orders/:orderId',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.get(ctx(req),
    req.params.unitId,req.params.orderId)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/orders/:orderId/release',async(req:Request,res:Response,next)=>{
  try{res.status(200).json({ok:true,data:await service.release(ctx(req),
    req.params.unitId,req.params.orderId)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/orders/:orderId/transition',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.advanceNative(ctx(req),
    req.params.unitId,req.params.orderId,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/orders/:orderId/escalate',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.escalate(ctx(req),
    req.params.unitId,req.params.orderId,req.body)});}catch(e){next(e);}
 });
 // Never expose an unauthenticated external-event or ACK route. Provider
 // events are parsed by an installed signed adapter inside trusted runtime.
 return router;
}
