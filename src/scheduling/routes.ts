import {Router,type Request} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import {FirestoreCustomerRepository} from '../customers/firestoreRepository';
import {createOrderPaymentRuntime} from '../orderPayments/runtime';
import {FirestoreScheduleRepository} from './firestoreRepository';
import {SchedulingService} from './service';
import {BookingDepositService} from './deposits';

function context(req:Request){
 if(!req.tenantContext)throw new ApplicationError({category:'FORBIDDEN',
  code:'SCHEDULE_TENANT_REQUIRED',message:'Verified tenant membership required.'});
 return req.tenantContext;
}
export function createSchedulingRouter(
 service:SchedulingService=new SchedulingService(new FirestoreScheduleRepository(),new FirestoreCustomerRepository()),
 deposits:BookingDepositService=new BookingDepositService(new FirestoreScheduleRepository(),service,createOrderPaymentRuntime().resolver),
):Router{
 const router=Router();
 router.get('/units/:unitId/config',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.getConfig(context(req),req.params.unitId)});}catch(e){next(e);}
 });
 router.put('/units/:unitId/config',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.configure(context(req),req.params.unitId,req.body)});}catch(e){next(e);}
 });
 router.get('/units/:unitId/availability',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.availability(context(req),req.params.unitId,req.query)});}catch(e){next(e);}
 });
 router.get('/units/:unitId/bookings',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.list(context(req),req.params.unitId,req.query)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings',async(req,res,next)=>{
  try{res.status(201).json({ok:true,data:await service.reserve(context(req),req.params.unitId,req.body)});}catch(e){next(e);}
 });
 router.get('/units/:unitId/bookings/:id',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.get(context(req),req.params.unitId,req.params.id)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings/:id/confirm',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.confirm(context(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings/:id/reschedule',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.reschedule(context(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings/:id/cancel',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.cancel(context(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings/:id/complete',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.complete(context(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings/:id/deposit/pix',async(req,res,next)=>{
  try{res.json({ok:true,data:await deposits.issue(context(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings/:id/deposit/refresh',async(req,res,next)=>{
  try{res.json({ok:true,data:await deposits.refresh(context(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/maintenance',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.maintain(context(req),req.params.unitId,req.body)});}catch(e){next(e);}
 });
 router.post('/units/:unitId/bookings/:id/reminder/ack',async(req,res,next)=>{
  try{res.json({ok:true,data:await service.acknowledgeReminder(context(req),req.params.unitId,req.params.id,req.body)});}catch(e){next(e);}
 });
 return router;
}
