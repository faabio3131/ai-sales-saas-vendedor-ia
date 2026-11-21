import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {FulfillmentWorker} from '../src/fulfillment/worker';
import {createFulfillmentRouter} from '../src/fulfillment/routes';
import {ChannelCustomerNoticePort} from '../src/fulfillment/notifications';
import type {VerifiedCustomerChannelRepository} from '../src/fulfillment/trustedChannelIdentity';
import {ChannelService} from '../src/channels/service';
import type {ChannelInterface,OutboundChannelMessage} from '../src/channels/contracts';
import {parseSettings,extractCep,stateProjection,assessDelivery} from '../src/fulfillment/policy';
import {errorHandler} from '../src/api/middleware/errorHandler';
import {ProductionBoard} from '../src/ui/ProductionBoard';
import {ctx,config,fixture,NOW,sampleOrder,sampleCatalog} from './helpers/t06Fixtures';

const anchor=Date.parse(NOW);
const trustedChannel:VerifiedCustomerChannelRepository={
 get:async(tenantId,customerId,channel)=>({
  tenantId,customerId,channel,recipient:'5513999999999',
  verifiedAt:NOW,proofRef:'signed-provider-event-123',
  provenance:'SIGNED_PROVIDER_WEBHOOK' as const,
 }),
};
describe('T06 — deterministic delivery, native KDS, payment gates and isolation',()=>{
 it('releases a paid delivery once and persists preparation, ready, dispatch and completion',async()=>{
  const e=await fixture();
  const operation=await e.service.release(ctx(),'main',e.order.id);
  expect(operation).toMatchObject({operationMode:'NATIVE_OPERATIONS',
   state:'QUEUED',productionState:'QUEUED',deliveryState:'NOT_STARTED',version:1,
   assessment:{kind:'DELIVERY',accepted:true,zoneId:'centro',cep:'11700000',
     feeMinor:600,etaMinutes:55,etaSource:'MERCHANT_CONFIGURED_WINDOW',
     gpsValidated:false,liveTrackingAvailable:false},
  });
  expect(e.operations.orders.get(e.operations.key('pizza-a','main',e.order.id)))
   .toMatchObject({paymentState:'CONFIRMED',productionState:'QUEUED',
     deliveryState:'NOT_STARTED'});
  expect(e.operations.events.map(x=>x.name)).toEqual(['OrderReleasedToProduction']);
  const underway=await e.service.advanceNative(ctx('pizza-a','STAFF'),'main',
   e.order.id,{expectedVersion:1,action:'START'});
  expect(underway).toMatchObject({state:'IN_PREPARATION',version:2});
  const ready=await e.service.advanceNative(ctx('pizza-a','STAFF'),'main',
   e.order.id,{expectedVersion:2,action:'READY'});
  expect(ready).toMatchObject({state:'READY',version:3});
  const dispatched=await e.service.advanceNative(ctx('pizza-a','MANAGER'),'main',
   e.order.id,{expectedVersion:3,action:'DISPATCH_DELIVERY'});
  expect(dispatched).toMatchObject({state:'OUT_FOR_DELIVERY',version:4,
   productionState:'READY',deliveryState:'OUT_FOR_DELIVERY'});
  const done=await e.service.advanceNative(ctx('pizza-a','MANAGER'),'main',
   e.order.id,{expectedVersion:4,action:'COMPLETE'});
  expect(done).toMatchObject({state:'COMPLETED',version:5,
   productionState:'COMPLETED',deliveryState:'COMPLETED'});
  expect(e.operations.events.map(x=>x.name)).toEqual([
   'OrderReleasedToProduction','ProductionStarted','OrderReady',
   'DeliveryDispatched','DeliveryCompleted',
  ]);
  expect((await e.settings.get('pizza-a','main'))?.activeOperations).toBe(0);
  expect(e.operations.orders.get(e.operations.key('pizza-a','main',e.order.id)))
   .toMatchObject({status:'CONFIRMED',paymentState:'CONFIRMED',
     productionState:'COMPLETED',deliveryState:'COMPLETED'});
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,
   ()=>anchor);
  expect(await worker.runOnce()).toMatchObject({claimed:4,delivered:4,retried:0});
  expect(e.notices.map(x=>x.name)).toEqual([
    'OrderReleasedToProduction','OrderReady','DeliveryDispatched','DeliveryCompleted',
  ]);
  expect(e.pdv.kitchen.size).toBe(0); // Native mode NEVER calls PDV
 });
 it('completes pickup without delivery address, delivery fee, dispatcher or GPS',async()=>{
  const e=await fixture({kind:'PICKUP'});
  const released=await e.service.release(ctx(),'main',e.order.id);
  expect(released.assessment).toMatchObject({
   kind:'PICKUP',feeMinor:0,etaMinutes:40,gpsValidated:false,
  });
  await e.service.advanceNative(ctx('pizza-a','STAFF'),'main',e.order.id,
   {expectedVersion:1,action:'START'});
  await e.service.advanceNative(ctx('pizza-a','STAFF'),'main',e.order.id,
   {expectedVersion:2,action:'READY'});
  await expect(e.service.advanceNative(ctx(),'main',e.order.id,
   {expectedVersion:3,action:'DISPATCH_DELIVERY'}))
   .rejects.toMatchObject({code:'FULFILLMENT_TRANSITION_FORBIDDEN'});
  const picked=await e.service.advanceNative(ctx(),'main',e.order.id,
   {expectedVersion:3,action:'COMPLETE'});
  expect(picked).toMatchObject({state:'COMPLETED',deliveryState:'PICKED_UP'});
  expect(e.operations.events.at(-1)?.name).toBe('OrderPickupCompleted');
 });
 it('rejects wrong CEP, misleading delivery zone, missing CEP and inactive zone',async()=>{
  const e=await fixture();
  const key=e.operations.key('pizza-a','main',e.order.id);
  e.operations.orders.set(key,sampleOrder({
   fulfillment:{kind:'DELIVERY',zoneId:'centro',
     address:'Rua A, 5, Santos - SP. CEP 11000-000'},
  }));
  await expect(e.service.release(ctx(),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_OUTSIDE_COVERAGE'});
  e.operations.orders.set(key,sampleOrder({
   fulfillment:{kind:'DELIVERY',zoneId:'centro',address:'Rua A 150, Centro'},
  }));
  await expect(e.service.release(ctx(),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_ADDRESS_CEP_REQUIRED'});
  e.operations.orders.set(key,sampleOrder({
   fulfillment:{kind:'DELIVERY',zoneId:'outside',
     address:'Rua A, 5, Praia Grande SP CEP 11700-000'},
  }));
  await expect(e.service.release(ctx(),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_OUTSIDE_COVERAGE'});
  expect(e.operations.operations.size).toBe(0);
  expect(e.operations.events).toHaveLength(0);
 });
 it('validates postal rule overlaps, formats and explicit merchant-configured ETA',()=>{
  expect(()=>extractCep('Rua Principal, 100, 11700-000, São Paulo')).not.toThrow();
  const base={tenantId:'pizza-a',unitId:'main'};
  expect(()=>parseSettings(base,{...config(),
    postalRanges:[
     {zoneId:'centro',fromCep:'11700000',toCep:'11750000'},
     {zoneId:'centro',fromCep:'11750000',toCep:'11799999'},
    ]},'owner',NOW)).toThrow();
  expect(()=>parseSettings(base,{...config(),postalRanges:[
   {zoneId:'centro',fromCep:'11700000',toCep:'11A99999'},
  ]},'owner',NOW)).toThrow();
  const rules=parseSettings(base,config(),'owner',NOW);
  expect(assessDelivery(sampleOrder(),rules,sampleCatalog()).gpsValidated).toBe(false);
  expect(stateProjection('OUT_FOR_DELIVERY','DELIVERY')).toEqual({
   productionState:'READY',deliveryState:'OUT_FOR_DELIVERY',
  });
 });
 it('makes 60 concurrent releases idempotent: one kitchen queue and one event',async()=>{
  const e=await fixture();
  const calls=await Promise.all(Array.from({length:60},
   ()=>e.service.release(ctx(),'main',e.order.id)));
  expect(new Set(calls.map(x=>x.orderId+':'+x.version)).size).toBe(1);
  expect(e.operations.operations.size).toBe(1);
  expect(e.operations.events).toHaveLength(1);
  expect(e.operations.jobs.size).toBe(1);
  expect((await e.settings.get('pizza-a','main'))?.activeOperations).toBe(1);
  await expect(e.service.advanceNative(ctx(),'main',e.order.id,
   {expectedVersion:999,action:'START'}))
   .rejects.toMatchObject({code:'FULFILLMENT_VERSION_CONFLICT'});
  expect(e.operations.events).toHaveLength(1);
 });
 it('blocks pending ordinary Pix, missing payment evidence, draft orders and wrong tenant',async()=>{
  const e=await fixture({paid:false,cod:false});
  await expect(e.service.release(ctx(),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_PAYMENT_NOT_SETTLED_OR_AUTHORIZED'});
  const f=await fixture();
  f.operations.payments.set(f.operations.key('pizza-a','main',f.order.id),
   {...f.payment,verificationSource:undefined});
  await expect(f.service.release(ctx(),'main',f.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_PAYMENT_NOT_SETTLED_OR_AUTHORIZED'});
  await expect(f.service.release(ctx('pizza-b'),'main',f.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_ORDER_NOT_CONFIRMED'});
  const key=f.operations.key('pizza-a','main',f.order.id);
  f.operations.orders.set(key,{...f.order,status:'DRAFT'});
  await expect(f.service.release(ctx(),'main',f.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_ORDER_NOT_CONFIRMED'});
  expect(f.operations.operations.size).toBe(0);
 });
 it('allows registered cash/card-on-delivery method but does not mark it paid',async()=>{
  const e=await fixture({paid:false,cod:true});
  const released=await e.service.release(ctx(),'main',e.order.id);
  expect(released.state).toBe('QUEUED');
  const order=e.operations.orders.get(e.operations.key('pizza-a','main',e.order.id))!;
  expect(order).toMatchObject({paymentState:'PENDING',productionState:'QUEUED'});
  expect(e.operations.payments.get(e.operations.key('pizza-a','main',e.order.id))
   ?.status).toBe('PENDING');
  // The live Firestore repository ALSO checks paymentMethodSettings atomically.
 });
 it('enforces operational RBAC, scope, and prevents mode switches with active orders',async()=>{
  const e=await fixture();
  await expect(e.service.release(ctx('pizza-a','VIEWER'),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_ROLE_DENIED'});
  await expect(e.service.publishSettings(ctx('pizza-a','STAFF'),'main',config()))
   .rejects.toMatchObject({code:'FULFILLMENT_ROLE_DENIED'});
  await e.service.release(ctx(),'main',e.order.id);
  await expect(e.service.advanceNative(ctx('pizza-a','ATTENDANT'),'main',e.order.id,
   {expectedVersion:1,action:'START'}))
   .rejects.toMatchObject({code:'FULFILLMENT_ROLE_DENIED'});
  await expect(e.service.get(ctx('pizza-b'),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_NOT_FOUND'});
  e.profile.capabilityRegistry.operationMode='INTEGRATED_OPERATIONS';
  await expect(e.service.publishSettings(ctx(),'main',{
   ...config('INTEGRATED_OPERATIONS'),expectedVersion:1,
  })).rejects.toMatchObject({code:'FULFILLMENT_MODE_ACTIVE_ORDERS'});
  expect((await e.settings.get('pizza-a','main'))?.operationMode).toBe('NATIVE_OPERATIONS');
 });
 it('rejects config changes while profile disagrees or adapter is unavailable',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  e.pdv.healthy=false;
  await expect(e.service.publishSettings(ctx(),'main',{
    ...config('INTEGRATED_OPERATIONS'),expectedVersion:1,
  })).rejects.toMatchObject({code:'FULFILLMENT_CONNECTOR_NOT_VERIFIED'});
  await expect(e.service.release(ctx(),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_CONNECTOR_NOT_VERIFIED'});
  e.pdv.healthy=true;
  await expect(e.service.publishSettings(ctx(),'main',{
   ...config('NATIVE_OPERATIONS'),expectedVersion:1,
  })).rejects.toMatchObject({code:'FULFILLMENT_PROFILE_MODE_MISMATCH'});
 });
 it('sends real-shaped customer notices ONLY after persisted status, with a verified channel identity',async()=>{
  const e=await fixture({kind:'PICKUP'});
  await e.service.release(ctx(),'main',e.order.id);
  const status=await e.service.advanceNative(ctx(),'main',e.order.id,
   {expectedVersion:1,action:'START'});
  await e.service.advanceNative(ctx(),'main',e.order.id,
   {expectedVersion:status.version,action:'READY'});
  const op=await e.service.get(ctx(),'main',e.order.id);
  const event=e.operations.events.find(e=>e.name==='OrderReady')!;
  const sendMessage=vi.fn(async(_message:OutboundChannelMessage)=>({ok:true,data:{
   channel:'WHATSAPP' as const,externalMessageId:'sent-1',acceptedAt:NOW,
  }}));
  const channel:ChannelInterface={
   id:'WHATSAPP',sendMessage,
   validateWebhook:async()=>({ok:true,data:true}),
   normalizeInbound:async()=>({ok:true,data:[]}),
  };
  const sender=new ChannelCustomerNoticePort(new ChannelService([channel]),{
   findById:async()=>({
    id:op.customerId,tenantId:op.tenantId,name:'Maria',status:'ACTIVE' as const,
    phone:'5513999999999',externalIdentities:[
     {source:'WHATSAPP_VERIFIED',value:'5513999999999'}],
    createdAt:NOW,updatedAt:NOW,
   }),
  },trustedChannel);
  await sender.send(event,op);
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(sendMessage.mock.calls[0][0]).toMatchObject({
   idempotencyKey:event.id,tenantId:'pizza-a',recipient:'5513999999999',
  });
  expect(JSON.stringify(sendMessage.mock.calls[0][0])).toContain('pronto para retirada');
  const unverified=new ChannelCustomerNoticePort(new ChannelService([channel]),{
   findById:async()=>({
    id:op.customerId,tenantId:op.tenantId,name:'Maria',status:'ACTIVE' as const,
    phone:'5513999999999',
    // A forged, CRM-editable claim is NOT signed verification.
    externalIdentities:[{source:'WHATSAPP_VERIFIED',value:'5513999999999'}],
    createdAt:NOW,updatedAt:NOW,
   }),
  },{get:async()=>null});
  await expect(unverified.send(event,op))
   .rejects.toMatchObject({code:'FULFILLMENT_CUSTOMER_CHANNEL_NOT_VERIFIED'});
  expect(sendMessage).toHaveBeenCalledTimes(1);
 });
 it('retries customer notification rather than claiming delivery when no provider is connected',async()=>{
  const e=await fixture();
  await e.service.release(ctx(),'main',e.order.id);
  const sender=new ChannelCustomerNoticePort(new ChannelService([]),{
   findById:async()=>({
    id:e.order.customerId,tenantId:'pizza-a',name:'Maria',status:'ACTIVE' as const,
    phone:'5513999999999',externalIdentities:[
      {source:'WHATSAPP_VERIFIED',value:'5513999999999'}],createdAt:NOW,updatedAt:NOW,
   }),
  },trustedChannel);
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,sender,
   ()=>anchor);
  expect(await worker.runOnce()).toMatchObject({claimed:1,delivered:0,retried:1});
  expect([...e.operations.jobs.values()][0]).toMatchObject({
    deliveryStatus:'PENDING',attemptCount:1,
  });
 });
 it('serves only authenticated operational HTTP endpoints and never exposes unsigned integration events',async()=>{
  const e=await fixture();
  const app=express();app.use(express.json());
  app.use('/ops',(req,_res,next)=>{
   if(req.header('x-test-role')!=='NO_AUTH')
    req.tenantContext=ctx(req.header('x-test-tenant')??'pizza-a',
      req.header('x-test-role')??'OWNER');
   next();
  },createFulfillmentRouter(e.service));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const root='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/ops/units/main';
   expect((await fetch(root+'/queue',{headers:{'x-test-role':'VIEWER'}})).status).toBe(403);
   expect((await fetch(root+'/queue',{headers:{'x-test-role':'NO_AUTH'}})).status).toBe(403);
   const released=await fetch(root+'/orders/'+e.order.id+'/release',{method:'POST'});
   expect(released.status).toBe(200);
   expect((await released.json()).data.state).toBe('QUEUED');
   const duplicated=await fetch(root+'/orders/'+e.order.id+'/release',{method:'POST'});
   expect((await duplicated.json()).data.version).toBe(1);
   await expect((await fetch(root+'/queue',{headers:{'x-test-tenant':'pizza-b'}})).json()
     .then(v=>v.data)).resolves.toEqual([]);
   expect((await fetch('http://127.0.0.1:'+(server.address() as AddressInfo).port+
    '/ops/external-event',{method:'POST'})).status).toBe(404);
  }finally{server.close();await once(server,'close');}
 });
 it('renders native KDS for kitchen roles and hides it from visitors',()=>{
  expect(renderToStaticMarkup(createElement(ProductionBoard,{
   tenantId:'pizza-a',role:'VIEWER',
  }))).toBe('');
  expect(renderToStaticMarkup(createElement(ProductionBoard,{
   tenantId:'pizza-a',role:'STAFF',
  }))).toContain('Cozinha, retirada e delivery');
  const ownerBoard=renderToStaticMarkup(createElement(ProductionBoard,{
   tenantId:'pizza-a',role:'OWNER',
  }));
  expect(ownerBoard).toContain('Adicionar faixa de CEP');
  expect(ownerBoard).toContain('CEP inicial');
  expect(ownerBoard).toContain('Remover faixa');
 });
});
