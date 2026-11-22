import {ApplicationError} from '../infrastructure/errors';
import type {AppErrorCategory} from '../types/contracts';
import type {ScheduleConfig,ScheduleServiceDefinition,ScheduleProfessional,
 ScheduleResource,ScheduleSlot,Shift,ScheduleBlock,Occupancy,Booking,PackPolicy,BookingPack} from './model';

export const MINUTE=60_000,DAY=86_400_000,MAX_DURATION=480*MINUTE;
export function reject(code:string,category:AppErrorCategory='VALIDATION'):never{
 throw new ApplicationError({category,code,message:'Scheduling operation cannot be completed.'});
}
export function object(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.getPrototypeOf(value)!==Object.prototype||
    Object.keys(value).some(k=>!keys.includes(k)))return reject('SCHEDULE_FIELDS_INVALID');
 return value as Record<string,unknown>;
}
export function id(value:unknown):string{
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,96}$/.test(value)||
    ['__proto__','constructor','prototype'].includes(value))return reject('SCHEDULE_ID_INVALID');
 return value;
}
export function integer(value:unknown,min:number,max:number):number{
 if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)
  return reject('SCHEDULE_NUMBER_INVALID');
 return Number(value);
}
function text(value:unknown,max=100):string{
 if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f]/.test(value))
  return reject('SCHEDULE_TEXT_INVALID');
 return value.trim();
}
function bool(v:unknown):boolean{
 if(typeof v!=='boolean')return reject('SCHEDULE_BOOLEAN_INVALID');
 return v;
}
function array(v:unknown,max:number):unknown[]{
 if(!Array.isArray(v)||v.length>max)return reject('SCHEDULE_ARRAY_INVALID');
 return v;
}
function distinct<T>(values:T[]):T[]{
 if(new Set(values).size!==values.length)return reject('SCHEDULE_DUPLICATE_ID');
 return values;
}
function rows<T extends {id:string}>(v:unknown,max:number,parse:(x:unknown)=>T):T[]{
 const result=array(v,max).map(parse);distinct(result.map(x=>x.id));return result;
}
export function day(value:unknown):string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return reject('SCHEDULE_DATE_INVALID');
 const date=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(date.valueOf())||date.toISOString().slice(0,10)!==value||
   value<'2000-01-01'||value>'2100-12-31')return reject('SCHEDULE_DATE_INVALID');
 return value;
}
export function instant(value:unknown):number{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
  return reject('SCHEDULE_INSTANT_INVALID');
 day(value.slice(0,10));
 if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||
  Number(value.slice(17,19))>59)return reject('SCHEDULE_INSTANT_INVALID');
 const ms=Date.parse(value);
 if(!Number.isSafeInteger(ms)||ms%MINUTE!==0)return reject('SCHEDULE_INSTANT_INVALID');
 return ms;
}
export function zone(v:unknown):string{
 if(typeof v!=='string'||v.length>80)return reject('SCHEDULE_TIMEZONE_INVALID');
 try{new Intl.DateTimeFormat('en-US',{timeZone:v}).format();}catch{return reject('SCHEDULE_TIMEZONE_INVALID');}
 return v;
}
function shifts(v:unknown):Shift[]{
 const list=array(v,42).map(x=>{
  const s=object(x,['day','startMinute','endMinute']);
  const startMinute=integer(s.startMinute,0,1439),endMinute=integer(s.endMinute,1,1440);
  if(startMinute>=endMinute||startMinute%15||endMinute%15)return reject('SCHEDULE_SHIFT_INVALID');
  return {day:integer(s.day,0,6),startMinute,endMinute};
 }).sort((a,b)=>a.day-b.day||a.startMinute-b.startMinute);
 if(list.some((s,i)=>i>0&&list[i-1].day===s.day&&list[i-1].endMinute>s.startMinute))
  return reject('SCHEDULE_SHIFT_OVERLAP');
 return list;
}
function person(v:unknown):ScheduleProfessional{
 const a=object(v,['id','name','active','shifts','title']);
 return {id:id(a.id),name:text(a.name),active:bool(a.active),shifts:shifts(a.shifts),
  ...(a.title===undefined?{}:{title:text(a.title,80)})};
}
function service(v:unknown):ScheduleServiceDefinition{
 const a=object(v,['id','name','active','durationMinutes','professionalIds','resourceIds','depositMinor','priceMinor','category']);
 const durationMinutes=integer(a.durationMinutes,15,480);
 if(durationMinutes%15)return reject('SCHEDULE_DURATION_GRID');
 const professionalIds=distinct(array(a.professionalIds,40).map(id));
 if(!professionalIds.length)return reject('SCHEDULE_PROFESSIONAL_REQUIRED');
 return {id:id(a.id),name:text(a.name),active:bool(a.active),durationMinutes,
   professionalIds,resourceIds:distinct(array(a.resourceIds,12).map(id)),
   depositMinor:integer(a.depositMinor,0,10_000_000),
   ...(a.priceMinor===undefined?{}:{priceMinor:integer(a.priceMinor,0,100_000_000)}),
   ...(a.category===undefined?{}:{category:text(a.category,80)})};
}
function block(v:unknown):ScheduleBlock{
 const a=object(v,['id','target','targetId','startAt','endAt']);
 if(a.target!=='UNIT'&&a.target!=='PROFESSIONAL'&&a.target!=='RESOURCE')
  return reject('SCHEDULE_BLOCK_TARGET');
 const startMs=instant(a.startAt),endMs=instant(a.endAt);
 if(endMs<=startMs||endMs-startMs>366*DAY)return reject('SCHEDULE_BLOCK_RANGE');
 if(a.target==='UNIT'&&a.targetId!==undefined)return reject('SCHEDULE_BLOCK_TARGET');
 return {id:id(a.id),target:a.target,...(a.target==='UNIT'?{}:{targetId:id(a.targetId)}),startMs,endMs};
}
function parsePack(raw:unknown):PackPolicy{
 const a=object(raw,['kind','cancelNoticeMinutes','noShowGraceMinutes','notifyWhatsApp']);
 if(!['SALON','BARBERSHOP','AESTHETICS_ADMIN','PROFESSIONAL_SERVICES'].includes(String(a.kind)))return reject('PACK_KIND_INVALID');
 return {kind:a.kind as BookingPack,cancelNoticeMinutes:integer(a.cancelNoticeMinutes,0,10080),
  noShowGraceMinutes:integer(a.noShowGraceMinutes,0,120),notifyWhatsApp:bool(a.notifyWhatsApp)};
}
export function parseConfig(raw:unknown):Omit<ScheduleConfig,'tenantId'|'unitId'|'version'|'updatedAt'|'updatedBy'> & {expectedVersion:number}{
 const a=object(raw,['expectedVersion','timezone','holdMinutes','reminderMinutes','shifts','holidays',
  'professionals','resources','services','blocks','pack']);
 const professionals=rows(a.professionals,40,person),resources:ScheduleResource[]=rows(a.resources,60,person),
  services=rows(a.services,60,service),blocks=rows(a.blocks,150,block);
 const pack=a.pack===undefined?undefined:parsePack(a.pack);
 for(const s of services){
  if(pack&&s.active&&(s.priceMinor===undefined||!s.category||s.depositMinor>s.priceMinor))
   return reject('PACK_SERVICE_PRICE_OR_CATEGORY_INVALID');
  if(s.professionalIds.some(p=>!professionals.some(x=>x.id===p))||
     s.resourceIds.some(r=>!resources.some(x=>x.id===r)))return reject('SCHEDULE_SERVICE_REFERENCE');
  if(s.active&&(!s.professionalIds.some(p=>professionals.some(x=>x.id===p&&x.active))||
     s.resourceIds.some(r=>!resources.some(x=>x.id===r&&x.active))))return reject('SCHEDULE_ACTIVE_REFERENCE');
 }
 for(const b of blocks){
  if(b.target==='PROFESSIONAL'&&!professionals.some(x=>x.id===b.targetId)||
     b.target==='RESOURCE'&&!resources.some(x=>x.id===b.targetId))
    return reject('SCHEDULE_BLOCK_REFERENCE');
 }
 return {expectedVersion:integer(a.expectedVersion,0,100000),timezone:zone(a.timezone),
  holdMinutes:integer(a.holdMinutes,5,60),reminderMinutes:integer(a.reminderMinutes,0,10080),
  shifts:shifts(a.shifts),holidays:distinct(array(a.holidays,366).map(day)),
  professionals,resources,services,blocks,...(pack?{pack}:{})};
}
const formats=new Map<string,Intl.DateTimeFormat>();
function local(ms:number,tz:string){
 let formatter=formats.get(tz);
 if(!formatter){
  formatter=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  if(formats.size>=128)formats.clear();
  formats.set(tz,formatter);
 }
 const p=Object.fromEntries(formatter.formatToParts(ms).map(x=>[x.type,x.value]));
 const date=p.year+'-'+p.month+'-'+p.day;
 const minute=Number(p.hour)*60+Number(p.minute);
 return {date,minute,weekday:new Date(date+'T00:00:00Z').getUTCDay()};
}
function inShift(shifts:Shift[],weekday:number,start:number,end:number){
 return shifts.some(s=>s.day===weekday&&s.startMinute<=start&&s.endMinute>=end);
}
export function overlaps(a:number,b:number,c:number,d:number){return a<d&&c<b;}
export function occupies(x:Occupancy|Booking,now:number):boolean{
 return x.status==='CONFIRMED'||(x.status==='HELD'&&x.holdUntilMs>now);
}
export function asOccupancy(b:Booking):Occupancy|null{
 if(b.status!=='HELD'&&b.status!=='CONFIRMED')return null;
 return {tenantId:b.tenantId,unitId:b.unitId,id:b.id,professionalId:b.professionalId,
  resourceIds:[...b.resourceIds],startMs:b.startMs,endMs:b.endMs,status:b.status,holdUntilMs:b.holdUntilMs};
}
export function definition(c:ScheduleConfig,serviceId:string,professionalId:string){
 const s=c.services.find(x=>x.id===serviceId&&x.active);
 const p=c.professionals.find(x=>x.id===professionalId&&x.active);
 if(!s||!p||!s.professionalIds.includes(p.id))return reject('SCHEDULE_SERVICE_UNAVAILABLE','CONFLICT');
 return {s,p};
}
export function slotAllowed(c:ScheduleConfig,serviceId:string,professionalId:string,start:number,
 now:number,existing:Occupancy[],ignoreId?:string):boolean{
 if(start<=now||start>now+366*DAY)return false;
 const {s,p}=definition(c,serviceId,professionalId),end=start+s.durationMinutes*MINUTE;
 const a=local(start,c.timezone),b=local(end-MINUTE,c.timezone);
 // Real UTC instants distinguish both occurrences of a repeated local hour.
 // Reject a service spanning a gap/fold or midnight; allow end at midnight.
 if(a.date!==b.date||a.minute%15||b.minute!==a.minute+s.durationMinutes-1||
   c.holidays.includes(a.date)||!inShift(c.shifts,a.weekday,a.minute,b.minute+1)||
   !inShift(p.shifts,a.weekday,a.minute,b.minute+1))return false;
 for(const rid of s.resourceIds){
  const r=c.resources.find(x=>x.id===rid&&x.active);
  if(!r||!inShift(r.shifts,a.weekday,a.minute,b.minute+1))return false;
 }
 if(c.blocks.some(x=>overlaps(start,end,x.startMs,x.endMs)&&(
  x.target==='UNIT'||x.target==='PROFESSIONAL'&&x.targetId===p.id||
  x.target==='RESOURCE'&&s.resourceIds.includes(x.targetId!))))return false;
 return !existing.some(x=>x.id!==ignoreId&&occupies(x,now)&&
  overlaps(start,end,x.startMs,x.endMs)&&
  (x.professionalId===p.id||x.resourceIds.some(r=>s.resourceIds.includes(r))));
}
export function dayWindow(date:string){const n=Date.parse(day(date)+'T00:00:00Z');return {start:n-DAY,end:n+2*DAY};}
export function slots(c:ScheduleConfig,serviceId:string,professionalId:string,date:string,now:number,
 existing:Occupancy[]):ScheduleSlot[]{
 const {s}=definition(c,serviceId,professionalId),out:ScheduleSlot[]=[];
 const w=dayWindow(date);
 for(let t=w.start;t<w.end;t+=15*MINUTE){
  const civil=local(t,c.timezone);
  if(civil.date!==date||!slotAllowed(c,serviceId,professionalId,t,now,existing))continue;
  out.push({professionalId,resourceIds:[...s.resourceIds],startAt:new Date(t).toISOString(),
   endAt:new Date(t+s.durationMinutes*MINUTE).toISOString(),localTime:date+'T'+
    String(Math.floor(civil.minute/60)).padStart(2,'0')+':'+String(civil.minute%60).padStart(2,'0'),timezone:c.timezone});
 }
 return out;
}
export function reason(v:unknown){return text(v,160);}
