import {Router,type Request} from 'express';
import {reject} from '../scheduling/rules';
import {FirestoreCustomerRepository} from '../customers/firestoreRepository';
import {FirestoreRetailRepository} from './firestoreRepository';
import {RetailService} from './service';
import {RetailPaymentService} from './payment';
import {createOrderPaymentRuntime} from '../orderPayments/runtime';
function ctx(req:Request){if(!req.tenantContext)return reject('RETAIL_TENANT_REQUIRED','FORBIDDEN');return req.tenantContext;}
export function createRetailRouter(service=new RetailService(new FirestoreRetailRepository(),new FirestoreCustomerRepository()),
 payment=new RetailPaymentService(service,createOrderPaymentRuntime().resolver)){
 const r=Router(),base='/units/:unitId',o=base+'/orders/:id';
 r.get(base+'/catalog',async(req,res,next)=>{try{res.json({ok:true,data:await service.catalog(ctx(req),req.params.unitId)});}catch(e){next(e);}});
 r.put(base+'/catalog',async(req,res,next)=>{try{res.json({ok:true,data:await service.publish(ctx(req),req.params.unitId,req.body)});}catch(e){next(e);}});
 r.get(base+'/inventory',async(req,res,next)=>{try{res.json({ok:true,data:await service.inventory(ctx(req),req.params.unitId)});}catch(e){next(e);}});
 r.post(base+'/inventory/:id/adjust',async(req,res,next)=>{try{res.json({ok:true,data:await service.adjust(ctx(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}});
 r.get(base+'/orders',async(req,res,next)=>{try{res.json({ok:true,data:await service.list(ctx(req),req.params.unitId,req.query)});}catch(e){next(e);}});
 r.post(base+'/orders',async(req,res,next)=>{try{res.status(201).json({ok:true,data:await service.createCart(ctx(req),req.params.unitId,req.body)});}catch(e){next(e);}});
 r.get(o,async(req,res,next)=>{try{res.json({ok:true,data:await service.get(ctx(req),req.params.unitId,req.params.id)});}catch(e){next(e);}});
 const commands=[['/edit',service.editCart.bind(service)],['/confirm',service.confirm.bind(service)],['/cashier',service.recordManual.bind(service)],
  ['/complete',service.complete.bind(service)],['/cancel',service.cancel.bind(service)],['/pix',payment.issue.bind(payment)],['/payment/refresh',payment.refresh.bind(payment)],['/payment/uncertain',payment.markUncertain.bind(payment)]] as const;
 for(const [path,command] of commands)r.post(o+path,async(req,res,next)=>{try{res.json({ok:true,data:await command(ctx(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}});
 return r;
}
