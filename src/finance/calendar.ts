import { ApplicationError } from '../infrastructure/errors';
import type {FinancePeriod,FinancialWindow} from './model';

function fail(code:string):never{
  throw new ApplicationError({category:'VALIDATION',code,message:'Invalid financial period.'});
}
export function validateLocalDate(value:string):void{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('FINANCE_ANCHOR_INVALID');
  const dt=new Date(value+'T00:00:00.000Z');
  if(!Number.isFinite(dt.getTime())||dt.toISOString().slice(0,10)!==value)
    fail('FINANCE_ANCHOR_INVALID');
}
export function localDateOf(iso:string,timezone:string):string{
  const dt=new Date(iso);
  if(!Number.isFinite(dt.getTime()))fail('FINANCE_INSTANT_INVALID');
  let fmt:Intl.DateTimeFormat;
  try{fmt=new Intl.DateTimeFormat('en-US',{timeZone:timezone,
    year:'numeric',month:'2-digit',day:'2-digit'});}
  catch{fail('FINANCE_TIMEZONE_INVALID');}
  const parts=fmt!.formatToParts(dt);
  const get=(type:string)=>parts.find(p=>p.type===type)?.value??'';
  return get('year')+'-'+get('month')+'-'+get('day');
}
function addDays(date:string,count:number):string{
  validateLocalDate(date);
  const utc=new Date(date+'T00:00:00.000Z');
  utc.setUTCDate(utc.getUTCDate()+count);
  return utc.toISOString().slice(0,10);
}
function startUtc(localDate:string,zone:string):string{
  validateLocalDate(localDate);
  // First UTC millisecond whose calendar date in the configured IANA timezone
  // equals or follows the requested local date, handling variable DST offsets.
  const center=Date.parse(localDate+'T00:00:00.000Z');
  let lo=center-48*3600_000,hi=center+48*3600_000;
  while(lo+1<hi){
    const mid=Math.floor((lo+hi)/2);
    if(localDateOf(new Date(mid).toISOString(),zone)<localDate)lo=mid;
    else hi=mid;
  }
  if(localDateOf(new Date(hi).toISOString(),zone)!==localDate)
    fail('FINANCE_NONEXISTENT_LOCAL_DATE');
  return new Date(hi).toISOString();
}
export function resolveWindow(input:{
 period:FinancePeriod;anchor?:string;timezone:string;weekStartsOn:number;now:Date;
}):FinancialWindow{
  if(!['day','week','month'].includes(input.period))fail('FINANCE_PERIOD_INVALID');
  if(!Number.isInteger(input.weekStartsOn)||input.weekStartsOn<0||input.weekStartsOn>6)
    fail('FINANCE_WEEK_START_INVALID');
  const asOf=input.now.toISOString();
  const anchor=input.anchor??localDateOf(asOf,input.timezone);
  validateLocalDate(anchor);
  const date=new Date(anchor+'T00:00:00.000Z');
  let start=anchor,end=addDays(anchor,1);
  if(input.period==='week'){
    const delta=(date.getUTCDay()-input.weekStartsOn+7)%7;
    start=addDays(anchor,-delta);
    end=addDays(start,7);
  }else if(input.period==='month'){
    start=anchor.slice(0,7)+'-01';
    const next=new Date(start+'T00:00:00.000Z');
    next.setUTCMonth(next.getUTCMonth()+1);
    end=next.toISOString().slice(0,10);
  }
  const startInclusive=startUtc(start,input.timezone);
  const endExclusive=startUtc(end,input.timezone);
  return {period:input.period,anchor,timezone:input.timezone,
    weekStartsOn:input.weekStartsOn,startInclusive,endExclusive,asOf};
}
