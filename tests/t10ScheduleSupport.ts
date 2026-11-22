import type {Booking,BookingPack,Occupancy,ScheduleConfig,ScheduleRepository,ScheduleScope,ScheduleTransaction,RequestReceipt} from '../src/scheduling/model';
import {asOccupancy} from '../src/scheduling/rules';
import {SchedulingService} from '../src/scheduling/service';
import type {TenantContext} from '../src/types/contracts';
export const BASE=Date.parse('2026-11-23T12:00:00Z');
export const scope=(tenantId='tenant-a',unitId='main'):ScheduleScope=>({tenantId,unitId});
export const actor=(tenantId='tenant-a',role='OWNER'):TenantContext=>({tenantId,userId:'staff-'+tenantId,role,requestId:'t10'});
const key=(s:ScheduleScope)=>JSON.stringify([s.tenantId,s.unitId]);
const copy=<T>(x:T):T=>structuredClone(x);
export class MemorySchedule implements ScheduleRepository{
 configs=new Map<string,ScheduleConfig>();
 bookings=new Map<string,Booking>();
 receipts=new Map<string,RequestReceipt>();
 grants=new Set<string>();
 packs=new Set<string>();
 enablePack(s:ScheduleScope,pack:BookingPack){this.packs.add(key(s)+':'+pack);}
 history:Booking[]=[];
 tail:Promise<void>=Promise.resolve();
 enable(s:ScheduleScope){this.grants.add(key(s));}
 disable(s:ScheduleScope){this.grants.delete(key(s));}
 async transact<T>(s:ScheduleScope,fn:(tx:ScheduleTransaction)=>Promise<T>){
  let release!:()=>void;const old=this.tail;this.tail=new Promise<void>(r=>{release=r;});await old;
  try{
   const k=key(s),cfg=this.configs.get(k),staged=new Map<string,Booking>(),
    receipts=new Map<string,RequestReceipt>();
   let nextConfig:ScheduleConfig|undefined;
   const rows=()=>[...this.bookings.values()].filter(b=>b.tenantId===s.tenantId&&b.unitId===s.unitId);
   const tx:ScheduleTransaction={
    config:async()=>cfg?copy(cfg):null,
    grant:async(_now,pack)=>this.grants.has(k)&&(!pack||this.packs.has(k+':'+pack)),
    booking:async(b)=>{const x=this.bookings.get(k+':'+b);return x?copy(x):null;},
    window:async(start,end)=>[...this.bookings.values()].filter(b=>b.tenantId===s.tenantId&&b.startMs<end&&b.endMs>start)
     .map(asOccupancy).filter((x):x is Occupancy=>x!==null).map(copy),
    records:async(start,end)=>rows().filter(b=>b.startMs>=start&&b.startMs<end).map(copy),
    future:async(now)=>rows().filter(b=>b.endMs>now).map(copy),
    due:async(now)=>rows().filter(b=>b.status==='HELD'&&b.holdUntilMs<=now||
     b.status==='CONFIRMED'&&(b.reminder?.state==='PENDING'&&b.reminder.dueMs<=now||
     b.reminder?.state==='READY'&&b.startMs<=now)).slice(0,100).map(copy),
    communicationDue:async(now)=>rows().filter(b=>b.notices?.some(n=>n.state==='PENDING'&&n.dueMs<=now||n.state==='CLAIMED'&&(n.claimUntilMs??0)<=now)).slice(0,25).map(copy),
    receipt:async(r)=>copy(this.receipts.get(k+':'+r)??null),
    saveConfig:c=>{nextConfig=copy(c);},
    saveBooking:b=>{staged.set(b.id,copy(b));},
    saveReceipt:(r,p)=>{receipts.set(r,copy(p));},
   };
   const result=await fn(tx);
   if(nextConfig)this.configs.set(k,nextConfig);
   for(const [id,b] of staged){this.bookings.set(k+':'+id,b);this.history.push(copy(b));}
   for(const [id,r] of receipts)this.receipts.set(k+':'+id,r);
   return copy(result);
  }finally{release();}
 }
}
export const shifts=Array.from({length:7},(_,day)=>({day,startMinute:540,endMinute:1080}));
export function config(depositMinor=0,timezone='America/Sao_Paulo'){
 return {expectedVersion:0,timezone,holdMinutes:15,reminderMinutes:60,shifts:copy(shifts),holidays:[],
  professionals:[{id:'pro-a',name:'Profissional A',active:true,shifts:copy(shifts)},
   {id:'pro-b',name:'Profissional B',active:true,shifts:copy(shifts)}],
  resources:[{id:'room-a',name:'Sala A',active:true,shifts:copy(shifts)},
   {id:'room-b',name:'Sala B',active:true,shifts:copy(shifts)}],
  services:[{id:'service-a',name:'Serviço A',active:true,durationMinutes:60,
    professionalIds:['pro-a','pro-b'],resourceIds:['room-a'],depositMinor},
   {id:'service-b',name:'Serviço B',active:true,durationMinutes:30,
    professionalIds:['pro-a','pro-b'],resourceIds:['room-b'],depositMinor:0}],blocks:[]};
}
export const customerRepo={findById:async(t:string,id:string)=>(
 id==='customer-'+t?{id,tenantId:t,name:'Cliente de teste',status:'ACTIVE' as const,
  createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',externalIdentities:[]}:null)};
export function harness(){
 let now=BASE;
 const store=new MemorySchedule(),service=new SchedulingService(store,customerRepo,()=>new Date(now));
 return {store,service,now:()=>now,advance:(delta:number)=>{now+=delta;},time:(ms:number)=>{now=ms;}};
}
export function input(tenant='tenant-a',startAt='2026-11-23T13:00:00Z',idempotencyKey='reserve-1',
 professionalId='pro-a',serviceId='service-a'){
 return {serviceId,professionalId,customerId:'customer-'+tenant,startAt,idempotencyKey,expectedConfigVersion:1};
}
