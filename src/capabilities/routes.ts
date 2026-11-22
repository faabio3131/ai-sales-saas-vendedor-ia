import {Router,type Request,type Response} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';
import type {BusinessProfileRepository} from '../business/contracts';
import type {CapabilityRepository} from './model';
import {FirestoreCapabilityRepository} from './firestoreRepository';
import {CapabilityRegistryService} from './service';
import {FirestoreCapabilityOperationalState,type CapabilityOperationalState} from './operationalState';

function context(req:Request){
 if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
  code:'TENANT_CONTEXT_REQUIRED',message:'Verified tenant membership required.'});
 return req.tenantContext;
}
export function createCapabilitiesRouter(
 store:CapabilityRepository=new FirestoreCapabilityRepository(),
 profiles:BusinessProfileRepository=new FirestoreBusinessProfileRepository(),
 active:CapabilityOperationalState=new FirestoreCapabilityOperationalState(),
):Router{
 const router=Router(),service=new CapabilityRegistryService(store,profiles,()=>new Date(),active);
 router.get('/units/:unitId/catalog',(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:service.catalog(context(req),req.params.unitId)});}
  catch(e){next(e);}
 });
 router.get('/units/:unitId/assignment',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.latest(context(req),req.params.unitId)});}
  catch(e){next(e);}
 });
 router.get('/units/:unitId/revisions/:version',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.getVersion(context(req),req.params.unitId,
   Number(req.params.version))});}catch(e){next(e);}
 });
 router.post('/units/:unitId/provision-defaults',async(req:Request,res:Response,next)=>{
  try{res.status(201).json({ok:true,
   data:await service.provisionDefaults(context(req),req.params.unitId,req.body)});}
  catch(e){next(e);}
 });
 router.post('/units/:unitId/revisions',async(req:Request,res:Response,next)=>{
  try{res.status(201).json({ok:true,
   data:await service.publish(context(req),req.params.unitId,req.body)});}
  catch(e){next(e);}
 });
 router.post('/units/:unitId/rollback',async(req:Request,res:Response,next)=>{
  try{res.status(201).json({ok:true,
   data:await service.rollback(context(req),req.params.unitId,req.body)});}
  catch(e){next(e);}
 });
 router.get('/units/:unitId/resolve/:capability',async(req:Request,res:Response,next)=>{
  try{res.json({ok:true,data:await service.resolve(context(req),req.params.unitId,req.params.capability)});}
  catch(e){next(e);}
 });
 return router;
}
