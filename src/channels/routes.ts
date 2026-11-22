import {Request,Response,Router} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import {FirestoreWhatsAppConnectionStore,WhatsAppRegistrationService} from './whatsappConnections';

function requireContext(req:Request){
 if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',code:'TENANT_CONTEXT_REQUIRED',message:'Tenant context is required.'});
 return req.tenantContext;
}
const registered=new WhatsAppRegistrationService(new FirestoreWhatsAppConnectionStore(),
 // External verification cannot be performed or faked through the merchant API.
 {verify:async()=>({verified:false,evidenceRef:''})});
export function createChannelsRouter(service:WhatsAppRegistrationService=registered):Router{
 const router=Router();
 router.get('/',async(req:Request,res:Response,next)=>{
  try{
   const ctx=requireContext(req);
   const unitId=typeof req.query.unitId==='string'?req.query.unitId:'main';
   res.status(200).json({ok:true,data:{
    tenantId:ctx.tenantId,supportedChannels:['WHATSAPP'],
    whatsapp:await service.overview(ctx,unitId),
   }});
  }catch(error){next(error);}
 });
 router.get('/whatsapp/units/:unitId',async(req,res,next)=>{
  try{res.status(200).json({ok:true,data:await service.overview(requireContext(req),req.params.unitId)});}
  catch(error){next(error);}
 });
 router.post('/whatsapp/units/:unitId/register',async(req,res,next)=>{
  try{res.status(200).json({ok:true,data:await service.register(requireContext(req),req.params.unitId,req.body)});}
  catch(error){next(error);}
 });
 return router;
}
