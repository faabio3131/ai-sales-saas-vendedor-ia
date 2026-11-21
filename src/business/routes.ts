import { Router,type Request,type Response } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreCustomerRepository } from '../customers/firestoreRepository';
import { FirestoreConversationRepository,FirestoreMessageRepository } from '../conversations/firestoreRepository';
import { FirestoreCatalogRepository } from '../catalog/firestoreRepository';
import type { BusinessProfileRepository,ScopedMemoryRepository } from './contracts';
import { FirestoreBusinessProfileRepository,FirestoreScopedMemoryRepository } from './firestoreRepository';
import { BusinessProfileService } from './service';
import { BusinessGroundingService } from './grounding';
import { BusinessMemoryService,type MemorySourceVerifier } from './memoryService';
import { ConversationMemorySourceVerifier } from './consentVerifier';
import { CommercialCustomerContextService } from './customerContext';
import type { CustomerRepository } from '../customers/contracts';
import type { CatalogRepository } from '../catalog/contracts';

export interface BusinessRouteDependencies {
  profiles?:BusinessProfileRepository;
  memories?:ScopedMemoryRepository;
  customers?:CustomerRepository;
  catalog?:CatalogRepository;
  verifier?:MemorySourceVerifier;
}
function auth(req:Request){
  if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',code:'TENANT_CONTEXT_REQUIRED',message:'Tenant context required.'});
  return req.tenantContext;
}
function timestamp(value:unknown):string|undefined{
  return typeof value==='string'?value:undefined;
}
export function createBusinessRouter(deps:BusinessRouteDependencies={}):Router{
  const router=Router();
  const profiles=deps.profiles??new FirestoreBusinessProfileRepository();
  const memories=deps.memories??new FirestoreScopedMemoryRepository();
  const customers=deps.customers??new FirestoreCustomerRepository();
  const catalog=deps.catalog??new FirestoreCatalogRepository();
  const verifier=deps.verifier??new ConversationMemorySourceVerifier(new FirestoreConversationRepository(),new FirestoreMessageRepository());
  const profile=new BusinessProfileService(profiles);
  const grounding=new BusinessGroundingService(profiles,catalog);
  const memory=new BusinessMemoryService(customers,profiles,memories,verifier);
  const customerContext=new CommercialCustomerContextService(grounding,memory);

  router.get('/units/:unitId/active',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await profile.effective(auth(req),req.params.unitId,timestamp(req.query.at))});}catch(e){next(e);}
  });
  router.get('/units/:unitId/latest',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await profile.latest(auth(req),req.params.unitId)});}catch(e){next(e);}
  });
  router.post('/units/:unitId/revisions',async(req:Request,res:Response,next)=>{
    try{res.status(201).json({ok:true,data:await profile.publish(auth(req),req.params.unitId,req.body)});}catch(e){next(e);}
  });
  router.post('/units/:unitId/answer',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await grounding.answer(auth(req),req.params.unitId,req.body?.question)});}catch(e){next(e);}
  });
  router.get('/units/:unitId/context',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await grounding.evidence(auth(req),req.params.unitId)});}catch(e){next(e);}
  });
  router.post('/units/:unitId/customers/:customerId/cognitive-context',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await customerContext.aiRequest(auth(req),req.params.unitId,req.params.customerId,req.body?.input)});}catch(e){next(e);}
  });
  router.get('/units/:unitId/customers/:customerId/memory',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await memory.get(auth(req),req.params.unitId,req.params.customerId)});}catch(e){next(e);}
  });
  router.post('/units/:unitId/customers/:customerId/memory/consent',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await memory.changeConsent(auth(req),req.params.unitId,req.params.customerId,req.body)});}catch(e){next(e);}
  });
  router.put('/units/:unitId/customers/:customerId/memory',async(req:Request,res:Response,next)=>{
    try{res.json({ok:true,data:await memory.remember(auth(req),req.params.unitId,req.params.customerId,req.body)});}catch(e){next(e);}
  });
  router.delete('/units/:unitId/customers/:customerId/memory',async(req:Request,res:Response,next)=>{
    try{await memory.forget(auth(req),req.params.unitId,req.params.customerId,Number(req.query.expectedVersion));res.status(204).end();}catch(e){next(e);}
  });
  return router;
}
