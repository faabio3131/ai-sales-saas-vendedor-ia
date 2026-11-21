import { Router,type Request } from 'express';
import {ApplicationError} from '../infrastructure/errors';
import {FirestoreBusinessProfileRepository} from '../business/firestoreRepository';
import {createRuntimeAIRouter} from '../ai/runtime';
import {FirestoreFinanceSourceRepository,FirestoreFinanceSettingsRepository} from './firestoreRepository';
import {FinancialService,requireFinanceAdmin} from './service';
import {FinanceQuestionService} from './questions';

function context(req:Request){
 if(!req.tenantContext)
  throw new ApplicationError({category:'FORBIDDEN',code:'FINANCE_TENANT_REQUIRED',
   message:'Authenticated tenant required.'});
 requireFinanceAdmin(req.tenantContext);
 return req.tenantContext;
}
export function createFinanceRouter(
 financial=new FinancialService(
  new FirestoreFinanceSourceRepository(),new FirestoreBusinessProfileRepository(),
  new FirestoreFinanceSettingsRepository()),
 questions=new FinanceQuestionService(financial,createRuntimeAIRouter()),
):Router{
 const router=Router();
 router.get('/units/:unitId/snapshot',async(req,res,next)=>{
  try{
   const data=await financial.snapshot(context(req),req.params.unitId,{
    period:req.query.period,anchor:req.query.anchor,
   });
   res.status(200).json({ok:true,data});
  }catch(error){next(error);}
 });
 router.get('/units/:unitId/settings',async(req,res,next)=>{
  try{res.json({ok:true,data:await financial.getSettings(context(req),req.params.unitId)});}
  catch(error){next(error);}
 });
 router.put('/units/:unitId/settings',async(req,res,next)=>{
  try{res.json({ok:true,data:await financial.setSettings(context(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 router.post('/units/:unitId/ask',async(req,res,next)=>{
  try{res.json({ok:true,data:await questions.ask(context(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 return router;
}
