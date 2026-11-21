import {Router,type Request,type Response} from 'express';
import type {GovernedAutonomyService} from './service';
import {createGovernanceRuntime} from './runtime';
import {ApplicationError} from '../infrastructure/errors';
function ctx(req:Request){
 if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
  code:'AUTONOMY_TENANT_CONTEXT_REQUIRED',message:'Tenant authorization required.'});
 return req.tenantContext;
}
export function createGovernanceRouter(service:GovernedAutonomyService=createGovernanceRuntime()):Router{
 const r=Router();
 r.get('/units/:unitId/policy',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.policy(ctx(req),req.params.unitId)});}catch(e){next(e);}
 });
 r.put('/units/:unitId/policy',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.publish(ctx(req),req.params.unitId,req.body)});}catch(e){next(e);}
 });
 r.post('/units/:unitId/approvals',async(req:Request,res:Response,next)=>{
  try{res.status(201).json({ok:true,data:await service.approve(ctx(req),req.params.unitId,req.body)});}
  catch(e){next(e);}
 });
 r.get('/units/:unitId/approvals/:id',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.approval(ctx(req),req.params.unitId,req.params.id)});}
  catch(e){next(e);}
 });
 r.post('/units/:unitId/approvals/:id/revoke',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.revoke(ctx(req),req.params.unitId,req.params.id)});}
  catch(e){next(e);}
 });
 r.post('/units/:unitId/execute',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.execute(ctx(req),req.params.unitId,req.body)});}
  catch(e){next(e);}
 });
 return r;
}
