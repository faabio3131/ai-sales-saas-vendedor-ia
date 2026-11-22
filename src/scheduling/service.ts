import {createHash,randomUUID} from 'node:crypto';
import type {TenantContext} from '../types/contracts';
import type {CustomerRepository} from '../customers/contracts';
import {requireBusinessScope,requireBusinessAdmin} from '../business/service';
import type {Booking,ScheduleRepository,ScheduleTransaction,ScheduleConfig,ScheduleScope} from './model';
import {DAY,MINUTE,MAX_DURATION,day,dayWindow,definition,id,instant,integer,object,occupies,
 parseConfig,reason,reject,slotAllowed,slots} from './rules';

const fingerprint=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export class SchedulingService{
 constructor(private readonly store:ScheduleRepository,private readonly customers:Pick<CustomerRepository,'findById'>,
  private readonly clock:()=>Date=()=>new Date()){}
 scope(ctx:TenantContext,unitId:string,mutate=false):ScheduleScope{
  if(!ctx.userId?.trim()||!(mutate?['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF']:
   ['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF','VIEWER']).includes(ctx.role??''))
   return reject('SCHEDULE_ACTOR_FORBIDDEN','FORBIDDEN');
  return requireBusinessScope(ctx,unitId);
 }
 now(){return this.clock().valueOf();}
 private async configFor(tx:ScheduleTransaction,now:number){
  if(!await tx.grant(now))return reject('SCHEDULE_CAPABILITY_REQUIRED','FORBIDDEN');
  const c=await tx.config();
  if(!c)return reject('SCHEDULE_CONFIG_REQUIRED','CONFLICT');
  return c;
 }
 private async getRow(tx:ScheduleTransaction,bookingId:string){
  const b=await tx.booking(id(bookingId));
  if(!b)return reject('SCHEDULE_BOOKING_NOT_FOUND','NOT_FOUND');
  return b;
 }
 async getConfig(ctx:TenantContext,u:string){
  const scope=this.scope(ctx,u);
  return this.store.transact(scope,async tx=>{
   if(!await tx.grant(this.now()))return reject('SCHEDULE_CAPABILITY_REQUIRED','FORBIDDEN');
   return tx.config();
  });
 }
 async configure(ctx:TenantContext,u:string,raw:unknown){
  requireBusinessAdmin(ctx);
  const scope=this.scope(ctx,u,true),{expectedVersion,...input}=parseConfig(raw);
  return this.store.transact(scope,async tx=>{
   const now=this.now();
   if(!await tx.grant(now))return reject('SCHEDULE_CAPABILITY_REQUIRED','FORBIDDEN');
   const current=await tx.config();
   if((current?.version??0)!==expectedVersion)return reject('SCHEDULE_CONFIG_VERSION_CONFLICT','CONFLICT');
   // No silent invalidation: change shifts, vacations or resources only after
   // affected future reservations are cancelled/rescheduled/expired.
   if((await tx.future(now)).some(b=>occupies(b,now)))return reject('SCHEDULE_ACTIVE_BOOKINGS_BLOCK_CONFIG','CONFLICT');
   const next:ScheduleConfig={...scope,...input,version:expectedVersion+1,
    updatedAt:new Date(now).toISOString(),updatedBy:ctx.userId!};
   tx.saveConfig(next);return next;
  });
 }
 async availability(ctx:TenantContext,u:string,raw:unknown){
  const scope=this.scope(ctx,u),a=object(raw,['serviceId','professionalId','date']);
  const serviceId=id(a.serviceId),professionalId=id(a.professionalId),date=day(a.date);
  return this.store.transact(scope,async tx=>{
   const now=this.now(),c=await this.configFor(tx,now),w=dayWindow(date);
   if(w.end<now||w.start>now+367*DAY)return [];
   const locks=await tx.window(w.start,w.end+MAX_DURATION);
   return slots(c,serviceId,professionalId,date,now,locks);
  });
 }
 async get(ctx:TenantContext,u:string,bookingId:string){
  const scope=this.scope(ctx,u,true);
  return this.store.transact(scope,tx=>this.getRow(tx,bookingId));
 }
 async list(ctx:TenantContext,u:string,raw:unknown){
  const scope=this.scope(ctx,u,true),a=object(raw,['startAt','endAt']);
  const start=instant(a.startAt),end=instant(a.endAt);
  if(end<=start||end-start>31*DAY)return reject('SCHEDULE_RANGE_INVALID');
  return this.store.transact(scope,async tx=>(await tx.records(start,end)).sort((a,b)=>a.startMs-b.startMs));
 }
 private async replay(tx:ScheduleTransaction,key:string,hash:string){
  const receipt=await tx.receipt(key);
  if(!receipt)return null;
  if(receipt.fingerprint!==hash)return reject('SCHEDULE_IDEMPOTENCY_CONFLICT','CONFLICT');
  return this.getRow(tx,receipt.bookingId);
 }
 private next(b:Booking,ctx:TenantContext,now:number,patch:Partial<Booking>){
  return {...b,...patch,version:b.version+1,updatedAt:new Date(now).toISOString(),transitionBy:ctx.userId!};
 }
 private reminder(b:Booking,c:ScheduleConfig){
  return {dueMs:b.startMs-c.reminderMinutes*MINUTE,state:'PENDING' as const,
   key:b.id+'_'+b.version};
 }
 async reserve(ctx:TenantContext,u:string,raw:unknown){
  const scope=this.scope(ctx,u,true),a=object(raw,['serviceId','professionalId','customerId','startAt','idempotencyKey','expectedConfigVersion']);
  const serviceId=id(a.serviceId),professionalId=id(a.professionalId),customerId=id(a.customerId),
   startMs=instant(a.startAt),key=id(a.idempotencyKey),expectedConfigVersion=integer(a.expectedConfigVersion,1,100000);
  const hash=fingerprint(['RESERVE',serviceId,professionalId,customerId,startMs,expectedConfigVersion]);
  const customer=await this.customers.findById(scope.tenantId,customerId);
  if(!customer||customer.tenantId!==scope.tenantId||customer.id!==customerId||customer.status!=='ACTIVE')
   return reject('SCHEDULE_CUSTOMER_INVALID','FORBIDDEN');
  const bookingId='booking_'+randomUUID().replace(/-/g,'');
  return this.store.transact(scope,async tx=>{
   const replay=await this.replay(tx,key,hash);
   if(replay)return replay;
   const now=this.now(),c=await this.configFor(tx,now);
   if(c.version!==expectedConfigVersion)return reject('SCHEDULE_CONFIG_VERSION_CONFLICT','CONFLICT');
   const {s}=definition(c,serviceId,professionalId),endMs=startMs+s.durationMinutes*MINUTE;
   if(!slotAllowed(c,serviceId,professionalId,startMs,now,await tx.window(startMs,endMs)))
    return reject('SCHEDULE_SLOT_UNAVAILABLE','CONFLICT');
   const b:Booking={...scope,id:bookingId,version:1,configVersion:c.version,
    customerId,serviceId,professionalId,resourceIds:[...s.resourceIds],startMs,endMs,
    timezone:c.timezone,status:'HELD',holdUntilMs:Math.min(startMs,now+c.holdMinutes*MINUTE),
    deposit:{amountMinor:s.depositMinor,currency:'BRL',status:s.depositMinor?'UNPAID':'NOT_REQUIRED'},
    createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),
    createdBy:ctx.userId!,transitionBy:ctx.userId!};
   tx.saveBooking(b);tx.saveReceipt(key,{fingerprint:hash,bookingId});return b;
  });
 }
 private async transition(ctx:TenantContext,u:string,bookingId:string,key:string,hash:string,expectedVersion:number,
  fn:(tx:ScheduleTransaction,b:Booking,now:number)=>Promise<Booking>){
  const scope=this.scope(ctx,u,true);
  return this.store.transact(scope,async tx=>{
   const replay=await this.replay(tx,key,hash);
   if(replay)return replay;
   const b=await this.getRow(tx,bookingId);
   if(b.version!==expectedVersion)return reject('SCHEDULE_BOOKING_VERSION_CONFLICT','CONFLICT');
   const next=await fn(tx,b,this.now());
   tx.saveBooking(next);tx.saveReceipt(key,{fingerprint:hash,bookingId:b.id});return next;
  });
 }
 async confirm(ctx:TenantContext,u:string,bookingId:string,raw:unknown){
  const a=object(raw,['expectedVersion','idempotencyKey']),key=id(a.idempotencyKey),
   version=integer(a.expectedVersion,1,100000);
  return this.transition(ctx,u,id(bookingId),key,fingerprint(['CONFIRM',bookingId,version]),version,
   async(tx,b,now)=>{
    if(b.status!=='HELD'||b.holdUntilMs<=now||b.startMs<=now)
     return reject('SCHEDULE_HOLD_EXPIRED_OR_INVALID','CONFLICT');
    if(b.deposit.status!=='NOT_REQUIRED'&&b.deposit.status!=='CONFIRMED')
     return reject('SCHEDULE_DEPOSIT_REQUIRED','CONFLICT');
    const c=await this.configFor(tx,now);
    if(c.version!==b.configVersion)return reject('SCHEDULE_CONFIG_VERSION_CONFLICT','CONFLICT');
    if(!slotAllowed(c,b.serviceId,b.professionalId,b.startMs,now,await tx.window(b.startMs,b.endMs),b.id))
     return reject('SCHEDULE_SLOT_UNAVAILABLE','CONFLICT');
    const next=this.next(b,ctx,now,{status:'CONFIRMED'});
    return {...next,reminder:this.reminder(next,c)};
   });
 }
 async reschedule(ctx:TenantContext,u:string,bookingId:string,raw:unknown){
  const a=object(raw,['expectedVersion','idempotencyKey','professionalId','startAt']),
   key=id(a.idempotencyKey),version=integer(a.expectedVersion,1,100000),
   professionalId=id(a.professionalId),startMs=instant(a.startAt);
  return this.transition(ctx,u,id(bookingId),key,fingerprint(['RESCHEDULE',bookingId,version,professionalId,startMs]),version,
   async(tx,b,now)=>{
    if(!occupies(b,now)||b.startMs<=now)return reject('SCHEDULE_RESCHEDULE_INVALID','CONFLICT');
    if(b.deposit.status==='CREATING'||b.deposit.status==='REVIEW_REQUIRED')return reject('SCHEDULE_DEPOSIT_REVIEW_PENDING','CONFLICT');
    const c=await this.configFor(tx,now),{s}=definition(c,b.serviceId,professionalId),
     endMs=startMs+s.durationMinutes*MINUTE;
    if(c.version!==b.configVersion||s.depositMinor!==b.deposit.amountMinor)
     return reject('SCHEDULE_CONFIG_VERSION_CONFLICT','CONFLICT');
    if(!slotAllowed(c,b.serviceId,professionalId,startMs,now,await tx.window(startMs,endMs),b.id))
     return reject('SCHEDULE_SLOT_UNAVAILABLE','CONFLICT');
    const next=this.next(b,ctx,now,{professionalId,startMs,endMs,resourceIds:[...s.resourceIds],
     holdUntilMs:b.status==='HELD'?Math.min(b.holdUntilMs,startMs):b.holdUntilMs});
    return b.status==='CONFIRMED'?{...next,reminder:this.reminder(next,c)}:next;
   });
 }
 async cancel(ctx:TenantContext,u:string,bookingId:string,raw:unknown){
  const a=object(raw,['expectedVersion','idempotencyKey','reason']),key=id(a.idempotencyKey),
   version=integer(a.expectedVersion,1,100000),why=reason(a.reason);
  return this.transition(ctx,u,id(bookingId),key,fingerprint(['CANCEL',bookingId,version,why]),version,
   async(_tx,b,now)=>{
    if(b.status!=='HELD'&&b.status!=='CONFIRMED'||b.startMs<=now)
     return reject('SCHEDULE_CANCEL_INVALID','CONFLICT');
    return this.terminate(b,ctx,now,'CANCELLED',why);
   });
 }
 private terminate(b:Booking,ctx:TenantContext,now:number,status:'CANCELLED'|'EXPIRED',why:string){
  const deposit=['CONFIRMED','CREATING','PENDING','REVIEW_REQUIRED'].includes(b.deposit.status)?
   {...b.deposit,status:'REVIEW_REQUIRED' as const}:b.deposit;
  return this.next(b,ctx,now,{status,cancelReason:why,deposit,
   ...(b.reminder?{reminder:{...b.reminder,state:'CANCELLED' as const}}:{})});
 }
 async complete(ctx:TenantContext,u:string,bookingId:string,raw:unknown){
  const a=object(raw,['expectedVersion','idempotencyKey']),key=id(a.idempotencyKey),v=integer(a.expectedVersion,1,100000);
  return this.transition(ctx,u,id(bookingId),key,fingerprint(['COMPLETE',bookingId,v]),v,
   async(_tx,b,now)=>{
    if(b.status!=='CONFIRMED'||b.endMs>now)return reject('SCHEDULE_COMPLETE_INVALID','CONFLICT');
    return this.next(b,ctx,now,{status:'COMPLETED',
     ...(b.reminder?{reminder:{...b.reminder,state:'CANCELLED' as const}}:{})});
   });
 }
 /** Scoped maintenance: materialize expired holds and durable due reminders.
  * No external messaging or charge occurs inside the scheduling transaction.
  */
 async maintain(ctx:TenantContext,u:string,raw:unknown){
  requireBusinessAdmin(ctx);
  const scope=this.scope(ctx,u,true),a=object(raw,['startAt','endAt']),
   start=instant(a.startAt),end=instant(a.endAt);
  if(end<=start||end-start>31*DAY)return reject('SCHEDULE_RANGE_INVALID');
  return this.store.transact(scope,async tx=>{
   const now=this.now(),records=await tx.records(start,end);
   let expired=0,ready=0;
   // Cap Firestore writes: max 100 transitions per cycle, caller repeats.
   for(const b of records){
    if(expired+ready>=100)break;
    if(b.status==='HELD'&&b.holdUntilMs<=now){
     tx.saveBooking(this.terminate(b,ctx,now,'EXPIRED','Prazo de reserva expirado'));expired++;
    }else if(b.status==='CONFIRMED'&&b.startMs>now&&b.reminder?.state==='PENDING'&&b.reminder.dueMs<=now){
     tx.saveBooking(this.next(b,ctx,now,{reminder:{...b.reminder,state:'READY'}}));ready++;
    }
   }
   return {expired,ready,more:expired+ready===100};
  });
 }
 async acknowledgeReminder(ctx:TenantContext,u:string,bookingId:string,raw:unknown){
  const a=object(raw,['expectedVersion','idempotencyKey','reminderKey']),key=id(a.idempotencyKey),
   v=integer(a.expectedVersion,1,100000),reminderKey=id(a.reminderKey);
  return this.transition(ctx,u,id(bookingId),key,fingerprint(['REMINDER_ACK',bookingId,v,reminderKey]),v,
   async(_tx,b,now)=>{
    if(b.status!=='CONFIRMED'||b.startMs<=now||b.reminder?.state!=='READY'||b.reminder.key!==reminderKey)
     return reject('SCHEDULE_REMINDER_INVALID','CONFLICT');
    return this.next(b,ctx,now,{reminder:{...b.reminder,state:'ACKNOWLEDGED'}});
   });
 }
}
