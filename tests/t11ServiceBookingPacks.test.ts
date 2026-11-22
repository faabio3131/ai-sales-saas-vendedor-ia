import {describe,it,expect,vi} from 'vitest';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import express from 'express';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createSchedulingRouter} from '../src/scheduling/routes';
import {errorHandler} from '../src/api/middleware/errorHandler';
import {SchedulingPanel} from '../src/ui/SchedulingPanel';
import {BookingDepositService} from '../src/scheduling/deposits';
import {PackNoticeService} from '../src/bookingPacks/notices';
import type {PaymentProviderInterface} from '../src/payments/contracts';
import type {ProviderPaymentRequest,ProviderPaymentResult} from '../src/payments/model';
import {parseConfig,MINUTE} from '../src/scheduling/rules';
import {actor,scope,BASE,harness,config,input} from './t10ScheduleSupport';
import {packConfig,packFixture,packInput,PHONE} from './t11PackSupport';

const confirm=(h:Awaited<ReturnType<typeof packFixture>>,id:string,v=1)=>h.service.confirm(h.t,h.u,id,{expectedVersion:v,idempotencyKey:'confirm-'+id});
async function booked(h:Awaited<ReturnType<typeof packFixture>>){
 const b=await h.service.reserve(h.t,h.u,packInput());return confirm(h,b.id);
}
describe('T11 pack catalog, policy, attendance and isolation',()=>{
 it('accepts all four pack schemas, rejects fabricated pricing, clinical fields and invalid limits',()=>{
  for(const kind of ['SALON','BARBERSHOP','AESTHETICS_ADMIN','PROFESSIONAL_SERVICES'] as const)
   expect(parseConfig(packConfig(kind)).pack?.kind).toBe(kind);
  const p=packConfig('SALON',11000);
  expect(()=>parseConfig(p)).toThrow();
  expect(()=>parseConfig({...p,pack:{...p.pack,kind:'MEDICAL_TRIAGE'}})).toThrow();
  const valid=packConfig('AESTHETICS_ADMIN');
  expect(()=>parseConfig({...valid,pack:{...valid.pack,diagnosis:'x'}})).toThrow();
  expect(()=>parseConfig({...valid,services:[{...valid.services[0],medicalIndication:'x'}]})).toThrow();
  expect(()=>parseConfig({...valid,pack:{...valid.pack,noShowGraceMinutes:121}})).toThrow();
 });
 it('requires correct enabled pack grant, never assigns beauty to a generic scheduling-only tenant',async()=>{
  const h=harness();h.store.enable(scope());
  await expect(h.service.configure(actor(),'main',packConfig('SALON'))).rejects.toMatchObject({code:'PACK_CAPABILITY_REQUIRED'});
  await h.service.configure(actor(),'main',config());
  await expect(h.service.configure(actor(),'main',{...packConfig('SALON'),expectedVersion:1}))
   .rejects.toMatchObject({code:'PACK_CAPABILITY_REQUIRED'});
 });
 it('requires explicit acceptance of current policy; stores immutable price/signal policy snapshot',async()=>{
  const h=await packFixture('SALON');
  await expect(h.service.reserve(h.t,h.u,input())).rejects.toMatchObject({code:'PACK_POLICY_ACCEPTANCE_REQUIRED'});
  await expect(h.service.reserve(h.t,h.u,{...packInput(),acceptedPolicyVersion:2})).rejects.toMatchObject({code:'PACK_POLICY_ACCEPTANCE_REQUIRED'});
  const b=await h.service.reserve(h.t,h.u,packInput());
  expect(b.pack).toMatchObject({kind:'SALON',configVersion:1,priceMinor:10000,acceptedBy:h.t.userId,acceptedAt:new Date(BASE).toISOString()});
  expect(b.status).toBe('HELD');
  await expect(h.service.reserve(h.t,h.u,{...packInput(),priceMinor:1})).rejects.toMatchObject({code:'SCHEDULE_FIELDS_INVALID'});
  await expect(h.service.configure(h.t,h.u,{...packConfig('SALON'),expectedVersion:1})).rejects.toMatchObject({code:'SCHEDULE_ACTIVE_BOOKINGS_BLOCK_CONFIG'});
 });
 it('parallel hold requests have a single winner; same idempotency key returns canonical reservation',async()=>{
  const h=await packFixture('BARBERSHOP');
  const rows=await Promise.allSettled(Array.from({length:16},(_,i)=>h.service.reserve(h.t,h.u,packInput('tenant-a','2026-11-23T14:00:00Z','race-'+i))));
  expect(rows.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const b=rows.find(x=>x.status==='fulfilled')!;if(b.status!=='fulfilled')throw Error();
  const winner=rows.findIndex(x=>x.status==='fulfilled');
  expect((await h.service.reserve(h.t,h.u,packInput('tenant-a','2026-11-23T14:00:00Z','race-'+winner))).id).toBe(b.value.id);
 });
 it('check-in window and completion require persisted attendance; no-show cannot override a checked-in customer',async()=>{
  const h=await packFixture(),b=await booked(h);
  await expect(h.service.checkIn(h.t,h.u,b.id,{expectedVersion:b.version,idempotencyKey:'early'})).rejects.toMatchObject({code:'PACK_CHECK_IN_INVALID'});
  h.time(b.startMs-10*MINUTE);
  const arrived=await h.service.checkIn(h.t,h.u,b.id,{expectedVersion:b.version,idempotencyKey:'arrive'});
  expect(arrived.checkedInAt).toBeDefined();
  h.time(b.startMs+20*MINUTE);
  await expect(h.service.noShow(h.t,h.u,b.id,{expectedVersion:arrived.version,idempotencyKey:'fake-noshow'})).rejects.toMatchObject({code:'PACK_NO_SHOW_INVALID'});
  h.time(b.endMs);
  expect((await h.service.complete(h.t,h.u,b.id,{expectedVersion:arrived.version,idempotencyKey:'done'})).status).toBe('COMPLETED');
 });
 it('no-show only by manager/owner/admin after grace, replays exactly, releases slot and never confiscates deposit',async()=>{
  const h=await packFixture('BARBERSHOP'),b=await booked(h);
  await expect(h.service.noShow(h.t,h.u,b.id,{expectedVersion:b.version,idempotencyKey:'early'})).rejects.toMatchObject({code:'PACK_NO_SHOW_INVALID'});
  h.time(b.startMs+15*MINUTE);
  const req={expectedVersion:b.version,idempotencyKey:'absent'};
  await expect(h.service.noShow(actor('tenant-a','ATTENDANT'),h.u,b.id,req)).rejects.toMatchObject({code:'PACK_NO_SHOW_ROLE_REQUIRED'});
  const absent=await h.service.noShow(actor('tenant-a','MANAGER'),h.u,b.id,req);
  expect(absent.status).toBe('NO_SHOW');expect(absent.noShowAt).toBeDefined();
  expect(await h.service.noShow(h.t,h.u,b.id,req)).toEqual(absent);
  expect(absent.notices?.every(n=>n.state!=='PENDING')).toBe(true);
  const next=await h.service.reserve(h.t,h.u,packInput('tenant-a',new Date(b.startMs+30*MINUTE).toISOString(),'after-falta'));
  expect(next.status).toBe('HELD');
 });
 it('late cancellation recorded without charge or retention; stale communication superseded',async()=>{
  const h=await packFixture('SALON'),b=await booked(h);h.advance(10*MINUTE);
  const cancelled=await h.service.cancel(h.t,h.u,b.id,{expectedVersion:b.version,idempotencyKey:'cancel',reason:'Pedido cliente'});
  expect(cancelled).toMatchObject({status:'CANCELLED',lateCancellation:true,deposit:{status:'NOT_REQUIRED'}});
  expect(cancelled.notices?.find(x=>x.kind==='CONFIRMATION')?.state).toBe('SUPERSEDED');
  expect(cancelled.notices?.find(x=>x.kind==='CANCELLATION')?.state).toBe('PENDING');
 });
 it('isolates foreign tenant/unit profile, bookings, customer and availability projection',async()=>{
  const h=await packFixture('AESTHETICS_ADMIN'),b=await booked(h);
  h.setScope(scope('tenant-b','main'),'AESTHETICS_ADMIN');
  await h.service.configure(actor('tenant-b'),'main',packConfig('AESTHETICS_ADMIN'));
  await expect(h.service.get(actor('tenant-b'),'main',b.id)).rejects.toMatchObject({code:'SCHEDULE_BOOKING_NOT_FOUND'});
  await expect(h.service.get(h.t,'other',b.id)).rejects.toMatchObject({code:'SCHEDULE_BOOKING_NOT_FOUND'});
  await expect(h.service.reserve(h.t,h.u,{...packInput(),customerId:'customer-tenant-b'})).rejects.toMatchObject({code:'SCHEDULE_CUSTOMER_INVALID'});
  const slots=await h.service.availability(actor('tenant-a','VIEWER'),h.u,{serviceId:'service-a',professionalId:'pro-a',date:'2026-11-23'});
  expect(JSON.stringify(slots)).not.toMatch(/customer|bookingId|phone|deposit|clinical/);
 });
});
describe('T11 verified communication journey',()=>{
 it('only persisted confirmation causes a notice; sends once across simultaneous workers; respects minimal text',async()=>{
  const h=await packFixture('AESTHETICS_ADMIN'),b=await h.service.reserve(h.t,h.u,packInput());
  await h.notice.cycle(h.s);expect(h.sender.send).not.toHaveBeenCalled();
  const c=await confirm(h,b.id);
  await Promise.all([h.notice.processOne(h.s,c.id),h.notice.processOne(h.s,c.id),h.notice.cycle(h.s)]);
  expect(h.sender.send).toHaveBeenCalledTimes(1);
  const row=await h.service.get(h.t,h.u,c.id);
  expect(row.notices?.[0]).toMatchObject({kind:'CONFIRMATION',state:'ACCEPTED_BY_PROVIDER',externalMessageId:'wamid.test_result'});
  const send=h.sender.send.mock.calls[0][0];
  expect(send).toMatchObject({tenantId:'tenant-a',unitId:'main',recipient:PHONE});
  expect(send.text).toMatch(/confirmado/);expect(send.text).not.toMatch(/Avaliação|cliente de teste|sinal|diagnóstico|customer-/i);
  await h.notice.cycle(h.s);expect(h.sender.send).toHaveBeenCalledTimes(1);
 });
 it('reschedule suppresses an unsent previous confirmation and sends only new civil time',async()=>{
  const h=await packFixture('BARBERSHOP'),b=await booked(h);
  const moved=await h.service.reschedule(h.t,h.u,b.id,{expectedVersion:b.version,idempotencyKey:'move',professionalId:'pro-b',startAt:'2026-11-23T15:00:00Z'});
  expect(moved.notices?.[0].state).toBe('SUPERSEDED');
  await h.notice.cycle(h.s);
  expect(h.sender.send).toHaveBeenCalledTimes(1);expect(h.sender.send.mock.calls[0][0].text).toContain('alterado');
  expect(h.sender.send.mock.calls[0][0].text).toContain('12:00');
 });
 it('reminder becomes durable at due time, accepted only once, independent manual ACK',async()=>{
  const h=await packFixture(),b=await booked(h);await h.notice.cycle(h.s);
  h.advance(60*MINUTE);await h.service.maintainDue(h.s);
  await Promise.all([h.notice.cycle(h.s),h.notice.cycle(h.s)]);
  expect(h.sender.send).toHaveBeenCalledTimes(2);
  const r=await h.service.get(h.t,h.u,b.id);
  expect(r.reminder?.state).toBe('READY');
  expect(r.notices?.find(n=>n.kind==='REMINDER')?.state).toBe('ACCEPTED_BY_PROVIDER');
  await h.service.acknowledgeReminder(h.t,h.u,b.id,{expectedVersion:r.version,idempotencyKey:'ack',reminderKey:r.reminder!.key});
 });
 it('verified opt-out blocks delivery; admin explicitly requeues only after opt-in, no duplicate accepted status',async()=>{
  const h=await packFixture(),b=await booked(h);h.optOut();
  expect(await h.notice.processOne(h.s,b.id)).toBe('BLOCKED');
  expect(h.sender.send).not.toHaveBeenCalled();
  const r=await h.service.get(h.t,h.u,b.id),key=r.notices![0].key;
  await expect(h.notice.retryBlocked(actor('tenant-a','ATTENDANT'),h.u,b.id,{expectedVersion:r.version,noticeKey:key})).rejects.toMatchObject({category:'FORBIDDEN'});
  h.optIn();await h.notice.retryBlocked(h.t,h.u,b.id,{expectedVersion:r.version,noticeKey:key});
  expect(await h.notice.processOne(h.s,b.id)).toBe('ACCEPTED_BY_PROVIDER');
  expect(h.sender.send).toHaveBeenCalledTimes(1);
 });
 it('window closed, wrong-unit consent, revoked identity and disabled live gate never send',async()=>{
  for(const condition of ['closeWindow','wrongUnit','revoke','disableLive'] as const){
   const h=await packFixture(),b=await booked(h);h[condition]();
   await h.notice.cycle(h.s);expect(h.sender.send).not.toHaveBeenCalled();
   expect((await h.service.get(h.t,h.u,b.id)).notices?.[0].state).toBe('BLOCKED');
  }
 });
 it('provider timeout becomes REVIEW_REQUIRED and cannot be resent or requeued',async()=>{
  const h=await packFixture(),b=await booked(h);h.sender.send.mockRejectedValueOnce(Error('timeout'));
  expect(await h.notice.processOne(h.s,b.id)).toBe('REVIEW_REQUIRED');
  const r=await h.service.get(h.t,h.u,b.id);
  await expect(h.notice.retryBlocked(h.t,h.u,b.id,{expectedVersion:r.version,noticeKey:r.notices![0].key})).rejects.toMatchObject({code:'PACK_NOTICE_RETRY_DENIED'});
  await h.notice.cycle(h.s);expect(h.sender.send).toHaveBeenCalledTimes(1);
 });
 it('disabled notice policy has no communication side effect even after confirmation',async()=>{
  const h=await packFixture('SALON',0,false),b=await booked(h);
  expect(b.notices).toBeUndefined();await h.notice.cycle(h.s);expect(h.sender.send).not.toHaveBeenCalled();
 });
 it('claim crash transitions to review, stale reminder not sent after appointment start',async()=>{
  const h=await packFixture(),b=await booked(h);
  await h.store.transact(h.s,async tx=>{
   const current=(await tx.booking(b.id))!;
   tx.saveBooking({...current,version:current.version+1,notices:current.notices!.map(n=>({...n,state:'CLAIMED',claimUntilMs:BASE+MINUTE}))});
  });
  h.advance(2*MINUTE);await h.notice.cycle(h.s);
  expect((await h.service.get(h.t,h.u,b.id)).notices?.[0].state).toBe('REVIEW_REQUIRED');
  h.time(b.startMs-5*MINUTE);await h.service.maintainDue(h.s);
  h.time(b.startMs);await h.notice.cycle(h.s);
  expect(h.sender.send).not.toHaveBeenCalled();
 });
});
function payment(){
 let request:ProviderPaymentRequest|undefined,paid=false;
 const result=():ProviderPaymentResult=>({provider:'ASAAS',providerPaymentId:'psp-pack',referenceId:request!.tenantId+':'+request!.referenceId,
  amountMinor:request!.amountMinor,status:paid?'CONFIRMED':'PENDING',pixCode:'test-pix'});
 const createPix=vi.fn(async(r:ProviderPaymentRequest)=>{request=r;return result();});
 const getPaymentStatus=vi.fn(async(_id:string)=>result());
 const adapter={id:'ASAAS',createPix,getPaymentStatus} as unknown as PaymentProviderInterface;
 return {adapter,createPix,paid:()=>{paid=true;}};
}
describe('T11 service pack end-to-end API journeys',()=>{
 it('salon and barbershop complete authenticated reservation, verified deposit, reminder/communication, no-show or check-in lifecycle',async()=>{
  for(const kind of ['SALON','BARBERSHOP'] as const){
   const h=await packFixture(kind,2500),p=payment(),deposit=new BookingDepositService(h.store,h.service,{forNewPayment:async()=>p.adapter},()=>{});
   const app=express();app.use(express.json());app.use('/scheduling',(req,_res,next)=>{
    const t=req.header('x-test-tenant');if(t)req.tenantContext=actor(t,req.header('x-test-role')??'OWNER');next();
   },createSchedulingRouter(h.service,deposit,h.notice));app.use(errorHandler);
   const server=app.listen(0,'127.0.0.1');await once(server,'listening');
   try{
    const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/scheduling/units/main';
    const request=async(path:string,body?:unknown,t='tenant-a',role='OWNER')=>{
     const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(t?{'x-test-tenant':t}:{}),'x-test-role':role,'content-type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)});
     return {status:r.status,json:await r.json()};
    };
    expect((await request('/config',undefined,'')).status).toBe(403);
    expect((await request('/config')).json.data.pack.kind).toBe(kind);
    const av=await request('/availability?serviceId=service-a&professionalId=pro-a&date=2026-11-23');
    expect(av.status).toBe(200);expect(av.json.data.length).toBeGreaterThan(0);
    const held=await request('/bookings',packInput());expect(held.status).toBe(201);
    const id=held.json.data.id,route='/bookings/'+id;
    expect((await request(route,undefined,'tenant-b')).status).toBe(404);
    expect((await request(route+'/confirm',{expectedVersion:1,idempotencyKey:'no-pay'})).status).toBe(409);
    const pix=await request(route+'/deposit/pix',{expectedVersion:1,idempotencyKey:'pix'});
    expect(pix.json.data.deposit.status).toBe('PENDING');expect(p.createPix).toHaveBeenCalledTimes(1);
    p.paid();const paid=await request(route+'/deposit/refresh',{});
    expect(paid.json.data.deposit.status).toBe('CONFIRMED');
    const c=await request(route+'/confirm',{expectedVersion:paid.json.data.version,idempotencyKey:'confirmed'});
    expect(c.json.data.status).toBe('CONFIRMED');
    await h.notice.cycle(h.s);h.advance(60*MINUTE);await h.service.maintainDue(h.s);await h.notice.cycle(h.s);
    expect(h.sender.send).toHaveBeenCalledTimes(2);
    let row=(await request(route)).json.data;h.time(row.startMs+20*MINUTE);
    if(kind==='SALON'){
     const present=await request(route+'/check-in',{expectedVersion:row.version,idempotencyKey:'present'});
     expect(present.status).toBe(200);h.time(row.endMs);
     row=(await request(route+'/complete',{expectedVersion:present.json.data.version,idempotencyKey:'complete'})).json.data;
     expect(row.status).toBe('COMPLETED');
    }else{
     row=(await request(route+'/no-show',{expectedVersion:row.version,idempotencyKey:'absent'})).json.data;
     expect(row.status).toBe('NO_SHOW');expect(row.deposit.status).toBe('REVIEW_REQUIRED');
    }
   }finally{await new Promise<void>((resolve,reject)=>{server.close(e=>e?reject(e):resolve());server.closeAllConnections();});}
  }
 },20000);
 it('UI pack view is initialized without customer data, no unpersisted confirmation or medical form',()=>{
  const html=renderToStaticMarkup(createElement(SchedulingPanel,{tenantId:'a',unitId:'main',role:'OWNER',availablePacks:['SALON','BARBERSHOP','AESTHETICS_ADMIN']}));
  expect(html).toContain('Agenda e reservas');expect(html).not.toContain('Confirmar reserva');
  expect(html).not.toContain('Cliente de teste');expect(html).not.toMatch(/diagnóstico|prontuário/i);
 });
 it('runtime pack sender refuses live effects without production approval',async()=>{
  const h=await packFixture(),b=await booked(h);
  const prior=process.env.NODE_ENV,flag=process.env.ATENDEVENDE_BOOKING_WHATSAPP_LIVE_ENABLED;
  try{
   process.env.NODE_ENV='production';delete process.env.ATENDEVENDE_BOOKING_WHATSAPP_LIVE_ENABLED;
   const notices=new PackNoticeService(h.store,h.service,h.customers,h.identities,h.consent,h.window,h.sender);
   expect(await notices.processOne(h.s,b.id)).toBe('BLOCKED');expect(h.sender.send).not.toHaveBeenCalled();
  }finally{if(prior===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prior;if(flag===undefined)delete process.env.ATENDEVENDE_BOOKING_WHATSAPP_LIVE_ENABLED;else process.env.ATENDEVENDE_BOOKING_WHATSAPP_LIVE_ENABLED=flag;}
 });
});
