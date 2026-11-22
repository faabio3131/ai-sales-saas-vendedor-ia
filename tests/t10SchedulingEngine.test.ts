import {describe,it,expect,vi} from 'vitest';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import express from 'express';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSchedulingRouter} from '../src/scheduling/routes';
import {SchedulingPanel} from '../src/ui/SchedulingPanel';
import {errorHandler} from '../src/api/middleware/errorHandler';
import {BookingDepositService} from '../src/scheduling/deposits';
import type {PaymentProviderInterface} from '../src/payments/contracts';
import type {ProviderPaymentResult,ProviderPaymentRequest} from '../src/payments/model';
import {parseConfig,slotAllowed,slots,MINUTE} from '../src/scheduling/rules';
import type {ScheduleConfig,ScheduleBlock} from '../src/scheduling/model';
import {harness,config,scope,actor,input,BASE,shifts} from './t10ScheduleSupport';

const t=actor(),u='main';
async function setup(deposit=0){
 const h=harness();h.store.enable(scope());await h.service.configure(t,u,config(deposit));return h;
}
function data(timezone:string,dayShifts=shifts){
 const {expectedVersion:_v,...c}=config(0,timezone);
 return {...c,tenantId:'tenant-a',unitId:u,version:1,updatedAt:new Date(BASE).toISOString(),
  updatedBy:'test',shifts:dayShifts,professionals:c.professionals.map(p=>({...p,shifts:dayShifts})),
  resources:c.resources.map(r=>({...r,shifts:dayShifts}))} as ScheduleConfig;
}
describe('T10 deterministic scheduling and horizontal calendar',()=>{
 it('validates closed and duplicate shifts, service dependencies, invalid timezone, durations and block targets',()=>{
  expect(()=>parseConfig({...config(),timezone:'Not/AZone'})).toThrow();
  expect(()=>parseConfig({...config(),shifts:[{day:1,startMinute:540,endMinute:540}]})).toThrow();
  expect(()=>parseConfig({...config(),shifts:[...shifts,{day:1,startMinute:600,endMinute:660}]})).toThrow();
  const c=config();
  expect(()=>parseConfig({...c,services:[{...c.services[0],durationMinutes:17}]})).toThrow();
  expect(()=>parseConfig({...c,services:[{...c.services[0],resourceIds:['unknown']}]})).toThrow();
  expect(()=>parseConfig({...c,holidays:['2026-02-30']})).toThrow();
  expect(()=>parseConfig({...c,blocks:[{id:'bad',target:'RESOURCE',targetId:'foreign',
   startAt:'2026-11-23T13:00:00Z',endAt:'2026-11-23T14:00:00Z'}]})).toThrow();
  expect(()=>parseConfig({...c,unexpected:'tenant-b'})).toThrow();
  expect(parseConfig(c).services).toHaveLength(2);
 });
 it('correctly maps Sao Paulo and Tokyo civil days without crossing local shift boundaries',()=>{
  const sao=data('America/Sao_Paulo'),tokyo=data('Asia/Tokyo');
  const ov=Date.parse('2026-11-23T00:00:00Z');
  const br=slots(sao,'service-a','pro-a','2026-11-24',ov,[]);
  const jp=slots(tokyo,'service-a','pro-a','2026-11-24',ov,[]);
  expect(br[0].startAt).toBe('2026-11-24T12:00:00.000Z');
  expect(jp[0].startAt).toBe('2026-11-24T00:00:00.000Z');
  expect(br.at(-1)!.endAt).toBe('2026-11-24T21:00:00.000Z');
  expect(jp.at(-1)!.endAt).toBe('2026-11-24T09:00:00.000Z');
 });
 it('DST skips nonexistent civil time and distinguishes repeated hours by UTC instant',()=>{
  const wide=Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440}));
  const spring=data('America/New_York',wide),fall=data('America/New_York',wide);
  const s=slots(spring,'service-a','pro-a','2027-03-14',Date.parse('2027-01-01T00:00:00Z'),[]);
  expect(s.some(x=>x.localTime.includes('T02:'))).toBe(false);
  expect(s.some(x=>x.localTime==='2027-03-14T01:30')).toBe(false);
  const f=slots(fall,'service-b','pro-a','2026-11-01',Date.parse('2026-10-01T00:00:00Z'),[]);
  const repeats=f.filter(x=>x.localTime==='2026-11-01T01:00');
  expect(repeats.map(x=>x.startAt)).toEqual(['2026-11-01T05:00:00.000Z','2026-11-01T06:00:00.000Z']);
 });
 it('holiday, unit blocks, professional days off, resource blocking and exclusive end boundary',()=>{
  const c=data('America/Sao_Paulo'),start=Date.parse('2026-11-23T13:00:00Z');
  expect(slotAllowed(c,'service-a','pro-a',start,BASE,[])).toBe(true);
  c.holidays=['2026-11-23'];expect(slotAllowed(c,'service-a','pro-a',start,BASE,[])).toBe(false);c.holidays=[];
  for(const target of ['UNIT','PROFESSIONAL','RESOURCE'] as const){
   c.blocks=[{id:'b',target,startMs:start,endMs:start+60*MINUTE,
    ...(target==='UNIT'?{}:{targetId:target==='PROFESSIONAL'?'pro-a':'room-a'})} as ScheduleBlock];
   expect(slotAllowed(c,'service-a','pro-a',start,BASE,[])).toBe(false);
   expect(slotAllowed(c,'service-a','pro-a',start+60*MINUTE,BASE,[])).toBe(true);
  }
  c.blocks=[];c.resources[0].shifts=[];
  expect(slotAllowed(c,'service-a','pro-a',start,BASE,[])).toBe(false);
  expect(slotAllowed(c,'service-b','pro-a',start,BASE,[])).toBe(true);
 });
});
describe('T10 reservation lifecycle, atomicity, cross-unit locks, privacy',()=>{
 it('requires a configured and authorized capability, OWNER/ADMIN to configure; viewer gets no booking identity',async()=>{
  const h=harness();
  await expect(h.service.configure(t,u,config())).rejects.toMatchObject({code:'SCHEDULE_CAPABILITY_REQUIRED'});
  h.store.enable(scope());
  await expect(h.service.configure(actor('tenant-a','VIEWER'),u,config())).rejects.toMatchObject({category:'FORBIDDEN'});
  await h.service.configure(t,u,config());
  const b=await h.service.reserve(t,u,input());
  await expect(h.service.get(actor('tenant-a','VIEWER'),u,b.id)).rejects.toMatchObject({category:'FORBIDDEN'});
  await expect(h.service.list(actor('tenant-a','VIEWER'),u,{startAt:'2026-11-23T00:00:00Z',endAt:'2026-11-24T00:00:00Z'})).rejects.toMatchObject({category:'FORBIDDEN'});
  const slots=await h.service.availability(actor('tenant-a','VIEWER'),u,{serviceId:'service-a',professionalId:'pro-a',date:'2026-11-23'});
  expect(JSON.stringify(slots)).not.toMatch(/customer|bookingId|tenant-a|Cliente de teste/);
 });
 it('24 racing requests for the same slot yield one persisted hold and 23 conflicts',async()=>{
  const h=await setup();
  const results=await Promise.allSettled(Array.from({length:24},(_,i)=>
   h.service.reserve(t,u,input('tenant-a','2026-11-23T13:00:00Z','race-'+i))));
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(x=>x.status==='rejected'&&x.reason.code==='SCHEDULE_SLOT_UNAVAILABLE')).toHaveLength(23);
  expect(h.store.bookings.size).toBe(1);
 });
 it('shared professional and resource conflict across units, different tenants remain isolated',async()=>{
  const h=await setup();h.store.enable(scope('tenant-a','second'));h.store.enable(scope('tenant-b','main'));
  await h.service.configure(t,'second',config());await h.service.configure(actor('tenant-b'),u,config());
  const held=await h.service.reserve(t,u,input());
  await expect(h.service.reserve(t,'second',input('tenant-a','2026-11-23T13:00:00Z','second-1','pro-b')))
   .rejects.toMatchObject({code:'SCHEDULE_SLOT_UNAVAILABLE'});
  await expect(h.service.reserve(t,'second',input('tenant-a','2026-11-23T13:00:00Z','second-2','pro-a','service-b')))
   .rejects.toMatchObject({code:'SCHEDULE_SLOT_UNAVAILABLE'});
  await expect(h.service.reserve(t,'second',input('tenant-a','2026-11-23T13:00:00Z','second-3','pro-b','service-b')))
   .resolves.toMatchObject({status:'HELD'});
  await expect(h.service.reserve(actor('tenant-b'),u,input('tenant-b'))).resolves.toMatchObject({tenantId:'tenant-b'});
  await expect(h.service.get(actor('tenant-b'),u,held.id)).rejects.toMatchObject({code:'SCHEDULE_BOOKING_NOT_FOUND'});
  await expect(h.service.get(t,'second',held.id)).rejects.toMatchObject({code:'SCHEDULE_BOOKING_NOT_FOUND'});
 });
 it('same idempotency key returns canonical persisted booking; different input rejects; no confirmation without a hold',async()=>{
  const h=await setup(),b=await h.service.reserve(t,u,input());
  const replay=await h.service.reserve(t,u,input());expect(replay.id).toBe(b.id);
  await expect(h.service.reserve(t,u,input('tenant-a','2026-11-23T14:00:00Z')))
   .rejects.toMatchObject({code:'SCHEDULE_IDEMPOTENCY_CONFLICT'});
  await expect(h.service.confirm(t,u,'nonexistent',{expectedVersion:1,idempotencyKey:'confirm-missing'}))
   .rejects.toMatchObject({code:'SCHEDULE_BOOKING_NOT_FOUND'});
  const confirmed=await h.service.confirm(t,u,b.id,{expectedVersion:1,idempotencyKey:'confirm-1'});
  expect(confirmed).toMatchObject({id:b.id,status:'CONFIRMED',version:2,reminder:{state:'PENDING'}});
  expect(await h.service.get(t,u,b.id)).toEqual(confirmed);
  expect(await h.service.confirm(t,u,b.id,{expectedVersion:1,idempotencyKey:'confirm-1'})).toEqual(confirmed);
  await expect(h.service.confirm(t,u,b.id,{expectedVersion:1,idempotencyKey:'different'}))
   .rejects.toMatchObject({code:'SCHEDULE_BOOKING_VERSION_CONFLICT'});
 });
 it('releasing expired hold allows new reservation, old hold never confirms even if not materialized',async()=>{
  const h=await setup(),b=await h.service.reserve(t,u,input());
  h.advance(16*MINUTE);
  await expect(h.service.confirm(t,u,b.id,{expectedVersion:1,idempotencyKey:'expired-confirm'}))
   .rejects.toMatchObject({code:'SCHEDULE_HOLD_EXPIRED_OR_INVALID'});
  const fresh=await h.service.reserve(t,u,input('tenant-a','2026-11-23T13:00:00Z','fresh'));
  expect(fresh.id).not.toBe(b.id);
  expect(await h.service.maintainDue(scope())).toMatchObject({expired:1});
  expect((await h.service.get(t,u,b.id)).status).toBe('EXPIRED');
 });
 it('failed reschedule preserves old slot; successful move atomically frees old slot and replaces reminder',async()=>{
  const h=await setup(),a=await h.service.reserve(t,u,input());
  const c=await h.service.confirm(t,u,a.id,{expectedVersion:1,idempotencyKey:'confirm'});
  await h.service.reserve(t,u,input('tenant-a','2026-11-23T14:00:00Z','other','pro-b'));
  await expect(h.service.reschedule(t,u,c.id,{expectedVersion:2,idempotencyKey:'reschedule-bad',professionalId:'pro-a',startAt:'2026-11-23T14:00:00Z'}))
   .rejects.toMatchObject({code:'SCHEDULE_SLOT_UNAVAILABLE'});
  expect((await h.service.get(t,u,c.id)).startMs).toBe(c.startMs);
  const moved=await h.service.reschedule(t,u,c.id,{expectedVersion:2,idempotencyKey:'reschedule-good',professionalId:'pro-a',startAt:'2026-11-23T15:00:00Z'});
  expect(moved).toMatchObject({status:'CONFIRMED',version:3,startMs:Date.parse('2026-11-23T15:00:00Z')});
  expect(moved.reminder?.key).not.toBe(c.reminder?.key);
  await expect(h.service.reserve(t,u,input('tenant-a','2026-11-23T13:00:00Z','free-now'))).resolves.toMatchObject({status:'HELD'});
 });
 it('cancellation idempotently frees occupancy, maintains history, disallows stale replay and new confirmations',async()=>{
  const h=await setup(),b=await h.service.reserve(t,u,input());
  const req={expectedVersion:1,idempotencyKey:'cancel-1',reason:'Solicitação do cliente'};
  const c=await h.service.cancel(t,u,b.id,req);
  expect(c).toMatchObject({status:'CANCELLED',version:2});
  expect(await h.service.cancel(t,u,b.id,req)).toEqual(c);
  expect(h.store.history.map(b=>b.status)).toEqual(['HELD','CANCELLED']);
  await expect(h.service.confirm(t,u,b.id,{expectedVersion:2,idempotencyKey:'bad-confirm'})).rejects.toMatchObject({category:'CONFLICT'});
  await expect(h.service.reserve(t,u,input('tenant-a','2026-11-23T13:00:00Z','after-cancel'))).resolves.toMatchObject({status:'HELD'});
 });
 it('config CAS and updates while booked fail closed; cancellation permits migration; no stale reservations',async()=>{
  const h=await setup(),b=await h.service.reserve(t,u,input());
  await expect(h.service.configure(t,u,{...config(),expectedVersion:1})).rejects.toMatchObject({code:'SCHEDULE_ACTIVE_BOOKINGS_BLOCK_CONFIG'});
  await h.service.cancel(t,u,b.id,{expectedVersion:1,idempotencyKey:'cx',reason:'Cliente solicitou'});
  const c=await h.service.configure(t,u,{...config(),expectedVersion:1});
  expect(c.version).toBe(2);
  await expect(h.service.configure(t,u,{...config(),expectedVersion:1})).rejects.toMatchObject({code:'SCHEDULE_CONFIG_VERSION_CONFLICT'});
  await expect(h.service.reserve(t,u,input('tenant-a','2026-11-23T13:00:00Z','stale'))).rejects.toMatchObject({code:'SCHEDULE_CONFIG_VERSION_CONFLICT'});
 });
 it('automatically materializes due reminder only once, ack validates version/key, completion only after service end',async()=>{
  const h=await setup(),b=await h.service.reserve(t,u,input('tenant-a','2026-11-23T14:00:00Z'));
  const c=await h.service.confirm(t,u,b.id,{expectedVersion:1,idempotencyKey:'confirm'});
  h.advance(60*MINUTE);
  expect(await h.service.maintainDue(scope())).toMatchObject({ready:1,expired:0});
  expect(await h.service.maintainDue(scope())).toMatchObject({ready:0,expired:0});
  const ready=await h.service.get(t,u,c.id);
  await expect(h.service.acknowledgeReminder(t,u,c.id,{expectedVersion:ready.version,idempotencyKey:'wrong-ack',reminderKey:'bogus'}))
   .rejects.toMatchObject({code:'SCHEDULE_REMINDER_INVALID'});
  const ack=await h.service.acknowledgeReminder(t,u,c.id,{expectedVersion:ready.version,idempotencyKey:'right-ack',reminderKey:ready.reminder!.key});
  expect(ack.reminder?.state).toBe('ACKNOWLEDGED');
  await expect(h.service.complete(t,u,c.id,{expectedVersion:ack.version,idempotencyKey:'early-complete'})).rejects.toMatchObject({code:'SCHEDULE_COMPLETE_INVALID'});
  h.advance(2*60*MINUTE);
  expect((await h.service.complete(t,u,c.id,{expectedVersion:ack.version,idempotencyKey:'complete'})).status).toBe('COMPLETED');
 });
 it('maintenance expires long-horizon holds and ignores foreign units; overdue reminders never become sendable',async()=>{
  const h=await setup();h.store.enable(scope('tenant-b',u));await h.service.configure(actor('tenant-b'),u,config());
  const b=await h.service.reserve(t,u,input('tenant-a','2027-01-01T13:00:00Z','far'));
  const foreign=await h.service.reserve(actor('tenant-b'),u,input('tenant-b','2027-01-01T13:00:00Z','far'));
  h.advance(30*MINUTE);
  expect(await h.service.maintainDue(scope())).toMatchObject({expired:1,ready:0});
  expect((await h.service.get(t,u,b.id)).status).toBe('EXPIRED');
  expect((await h.service.get(actor('tenant-b'),u,foreign.id)).status).toBe('HELD');
 });
 it('rejects customer from another tenant and injected identity; cancellation still possible when grant revoked',async()=>{
  const h=await setup();
  await expect(h.service.reserve(t,u,{...input(),customerId:'customer-tenant-b'})).rejects.toMatchObject({code:'SCHEDULE_CUSTOMER_INVALID'});
  await expect(h.service.reserve(t,u,{...input(),tenantId:'tenant-b'})).rejects.toMatchObject({code:'SCHEDULE_FIELDS_INVALID'});
  const b=await h.service.reserve(t,u,input());
  h.store.disable(scope());
  await expect(h.service.confirm(t,u,b.id,{expectedVersion:1,idempotencyKey:'denied'})).rejects.toMatchObject({code:'SCHEDULE_CAPABILITY_REQUIRED'});
  expect((await h.service.cancel(t,u,b.id,{expectedVersion:1,idempotencyKey:'safe-cancel',reason:'Sem operação'})).status).toBe('CANCELLED');
 });
});
function provider(){
 let req:ProviderPaymentRequest|undefined,settled=false;
 const result=():ProviderPaymentResult=>({provider:'ASAAS',providerPaymentId:'psp-1',
  referenceId:req!.tenantId+':'+req!.referenceId,amountMinor:req!.amountMinor,status:settled?'CONFIRMED':'PENDING',
  pixCode:'test-pix'});
 const createPix=vi.fn(async(r:ProviderPaymentRequest)=>{req=r;return result();});
 const getPaymentStatus=vi.fn(async(_id:string)=>result());
 const p={id:'ASAAS',createPix,getPaymentStatus} as unknown as PaymentProviderInterface;
 return {p,createPix,getPaymentStatus,settle:()=>{settled=true;}};
}
describe('T10 deposit saga: no false payment confirmation, late payment and replay',()=>{
 it('requires verified PSP GET for paid signal, one Pix side effect despite concurrent retries',async()=>{
  const h=await setup(2500),p=provider(),d=new BookingDepositService(h.store,h.service,{forNewPayment:async()=>p.p},()=>{});
  const b=await h.service.reserve(t,u,input());
  await expect(h.service.confirm(t,u,b.id,{expectedVersion:1,idempotencyKey:'notpaid'})).rejects.toMatchObject({code:'SCHEDULE_DEPOSIT_REQUIRED'});
  const req={expectedVersion:1,idempotencyKey:'pix1'};
  const results=await Promise.all([d.issue(t,u,b.id,req),d.issue(t,u,b.id,req)]);
  expect(results.every(r=>r.id===b.id)).toBe(true);expect(p.createPix).toHaveBeenCalledTimes(1);
  const pending=await h.service.get(t,u,b.id);expect(pending.deposit).toMatchObject({amountMinor:2500,status:'PENDING'});
  await expect(h.service.confirm(t,u,b.id,{expectedVersion:pending.version,idempotencyKey:'pending'})).rejects.toMatchObject({code:'SCHEDULE_DEPOSIT_REQUIRED'});
  p.settle();const paid=await d.refresh(t,u,b.id,{});
  expect(paid.deposit.status).toBe('CONFIRMED');
  const confirmed=await h.service.confirm(t,u,b.id,{expectedVersion:paid.version,idempotencyKey:'paid-confirm'});
  expect(confirmed.status).toBe('CONFIRMED');
  expect((await h.service.cancel(t,u,b.id,{expectedVersion:confirmed.version,idempotencyKey:'paid-cancel',reason:'Solicitação do cliente'})).deposit.status).toBe('REVIEW_REQUIRED');
 });
 it('PSP mismatch is rejected; no caller-supplied paid state and no late reactivation after expiry',async()=>{
  const h=await setup(2500),p=provider(),d=new BookingDepositService(h.store,h.service,{forNewPayment:async()=>p.p},()=>{});
  const b=await h.service.reserve(t,u,input());
  await d.issue(t,u,b.id,{expectedVersion:1,idempotencyKey:'pix'});
  await expect(d.refresh(t,u,b.id,{status:'CONFIRMED'})).rejects.toMatchObject({code:'SCHEDULE_FIELDS_INVALID'});
  p.getPaymentStatus.mockResolvedValueOnce({provider:'ASAAS',providerPaymentId:'psp-1',status:'CONFIRMED',referenceId:'foreign',amountMinor:2500});
  await expect(d.refresh(t,u,b.id,{})).rejects.toMatchObject({code:'SCHEDULE_DEPOSIT_PSP_MISMATCH'});
  h.advance(16*MINUTE);await h.service.maintainDue(scope());p.settle();
  const late=await d.refresh(t,u,b.id,{});
  expect(late).toMatchObject({status:'EXPIRED',deposit:{status:'REVIEW_REQUIRED'}});
  await expect(h.service.confirm(t,u,b.id,{expectedVersion:late.version,idempotencyKey:'late-confirm'})).rejects.toMatchObject({category:'CONFLICT'});
 });
 it('unknown PSP outcome remains review-only; replay does not recharge; actual live flag checked before any side effect',async()=>{
  const h=await setup(2500),p=provider(),d=new BookingDepositService(h.store,h.service,{forNewPayment:async()=>p.p},()=>{});
  const b=await h.service.reserve(t,u,input());
  p.createPix.mockRejectedValueOnce(Error('timeout'));
  const req={expectedVersion:1,idempotencyKey:'uncertain'};
  const result=await d.issue(t,u,b.id,req);expect(result.deposit.status).toBe('REVIEW_REQUIRED');
  expect((await d.issue(t,u,b.id,req)).deposit.status).toBe('REVIEW_REQUIRED');expect(p.createPix).toHaveBeenCalledTimes(1);
  const blocked=new BookingDepositService(h.store,h.service,{forNewPayment:async()=>p.p},()=>{throw Error('NO_GO');});
  await expect(blocked.issue(t,u,b.id,req)).rejects.toThrow('NO_GO');
  expect(p.createPix).toHaveBeenCalledTimes(1);
 });
});
describe('T10 authenticated scheduling API and UI',()=>{
 it('real Express booking journey persists hold and confirmation; anonymous/foreign/viewer access blocked',async()=>{
  const h=await setup(),p=provider(),d=new BookingDepositService(h.store,h.service,{forNewPayment:async()=>p.p},()=>{});
  const app=express();app.use(express.json());app.use('/scheduling',(req,_res,next)=>{
   const tenant=req.header('x-test-tenant');if(tenant)req.tenantContext=actor(tenant,req.header('x-test-role')??'OWNER');next();
  },createSchedulingRouter(h.service,d));app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/scheduling/units/main';
   const req=async(path:string,body?:unknown,tenant='tenant-a',role='OWNER')=>{
    const res=await fetch(base+path,{method:body===undefined?'GET':'POST',
     headers:{...(tenant?{'x-test-tenant':tenant}:{}),'x-test-role':role,'content-type':'application/json'},
     ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
    return {status:res.status,json:await res.json()};
   };
   expect((await req('/config',undefined,'')).status).toBe(403);
   const a=await req('/availability?serviceId=service-a&professionalId=pro-a&date=2026-11-23');
   expect(a.status).toBe(200);expect(a.json.data.length).toBeGreaterThan(0);
   const b=await req('/bookings',input());expect(b.status).toBe(201);expect(b.json.data.status).toBe('HELD');
   const id=b.json.data.id;
   expect((await req('/bookings/'+id,undefined,'tenant-b')).status).toBe(404);
   expect((await req('/bookings/'+id,undefined,'tenant-a','VIEWER')).status).toBe(403);
   const c=await req('/bookings/'+id+'/confirm',{expectedVersion:1,idempotencyKey:'http-confirm'});
   expect(c.status).toBe(200);expect(c.json.data.status).toBe('CONFIRMED');
   expect((await req('/bookings/'+id)).json.data.version).toBe(2);
  }finally{await new Promise<void>((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});}
 },15000);
 it('render does not preload personal data or show confirmation for unpersisted records',()=>{
  const html=renderToStaticMarkup(createElement(SchedulingPanel,{tenantId:'a',unitId:'main',role:'OWNER'}));
  expect(html).toContain('Agenda e reservas');expect(html).not.toContain('Confirmar reserva');
  expect(html).not.toContain('Cliente de teste');
 });
});
