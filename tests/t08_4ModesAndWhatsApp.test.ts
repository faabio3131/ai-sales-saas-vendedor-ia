import {afterEach,describe,expect,it,vi} from 'vitest';
import {fixture,config,ctx,NOW} from './helpers/t06Fixtures';
import {FulfillmentWorker,EmptyProductionAdapterRegistry} from '../src/fulfillment/worker';
import {ChannelCustomerNoticePort} from '../src/fulfillment/notifications';
import {ChannelService} from '../src/channels/service';
import {WhatsAppDeliveryService,type WhatsAppSendRecord} from '../src/channels/whatsappDelivery';
import type {WhatsAppConnection} from '../src/channels/whatsappConnections';
import type {WhatsAppSecrets} from '../src/channels/whatsappVault';
import type {ChannelInterface} from '../src/channels/contracts';
import type {VerifiedProductionStatus} from '../src/fulfillment/model';

const clock=Date.parse(NOW);
afterEach(()=>vi.unstubAllEnvs());

describe('T08.4 — dual-mode contract, failure recovery and exclusive production',()=>{
 it('NATIVE: unique KDS queue, persisted preparation/delivery and zero PDV dispatch',async()=>{
  const e=await fixture({mode:'NATIVE_OPERATIONS'});
  const first=await e.service.release(ctx(),'main',e.order.id);
  expect(first).toMatchObject({state:'QUEUED',operationMode:'NATIVE_OPERATIONS'});
  expect((await e.service.list(ctx(),'main'))).toHaveLength(1);
  expect((await e.service.release(ctx(),'main',e.order.id)).version).toBe(1);
  await e.service.advanceNative(ctx('pizza-a','STAFF'),'main',e.order.id,
   {expectedVersion:1,action:'START'});
  await e.service.advanceNative(ctx('pizza-a','STAFF'),'main',e.order.id,
   {expectedVersion:2,action:'READY'});
  await e.service.advanceNative(ctx('pizza-a','MANAGER'),'main',e.order.id,
   {expectedVersion:3,action:'DISPATCH_DELIVERY'});
  await e.service.advanceNative(ctx('pizza-a','MANAGER'),'main',e.order.id,
   {expectedVersion:4,action:'COMPLETE'});
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,()=>clock);
  expect(await worker.runOnce()).toEqual({claimed:5,delivered:5,retried:0});
  expect(e.notices.map(v=>v.name)).toEqual(['OrderReleasedToProduction','ProductionStarted',
    'OrderReady','DeliveryDispatched','DeliveryCompleted']);
  expect(e.pdv.kitchen.size).toBe(0);
  expect((await e.settings.get('pizza-a','main'))?.activeOperations).toBe(0);
 });
 it('INTEGRATED: exactly one ticket, ACK persisted before first notice, signed ordered status and dedupe',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  const first=await e.service.release(ctx(),'main',e.order.id);
  expect(first).toMatchObject({state:'AWAITING_ACK',operationMode:'INTEGRATED_OPERATIONS'});
  expect(e.notices).toHaveLength(0);
  await expect(e.service.advanceNative(ctx(),'main',e.order.id,
   {expectedVersion:1,action:'START'}))
   .rejects.toMatchObject({code:'FULFILLMENT_NATIVE_ACTION_FORBIDDEN'});
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,()=>clock);
  expect(await worker.runOnce()).toEqual({claimed:1,delivered:1,retried:0});
  expect(e.pdv.dispatchLog).toHaveLength(1);
  expect(e.pdv.kitchen.size).toBe(1);
  expect(e.notices).toHaveLength(0); // ACK notification persisted; not sent before next claim
  const acked=await e.service.get(ctx(),'main',e.order.id);
  expect(acked).toMatchObject({state:'QUEUED',externalOrderId:'pdv_external_1'});
  const evt=(status:VerifiedProductionStatus['status'],id:string)=>({
   tenantId:acked.tenantId,unitId:acked.unitId,orderId:acked.orderId,
   correlationId:acked.correlationId,connectorId:e.pdv.id,
   externalOrderId:'pdv_external_1',providerEventId:id,status,
   proofRef:'adapter-verified-provider-signature',
  });
  await expect(e.service.verifyAndApply(e.pdv.id,'pizza-a','main',
   {signed:false,payload:evt('IN_PREPARATION','evt_preparation_a')}))
   .rejects.toMatchObject({code:'UNVERIFIED_INTEGRATION_EVENT'});
  await expect(e.service.verifyAndApply(e.pdv.id,'pizza-a','main',
   {signed:true,payload:evt('READY','evt_out_of_order')}))
   .rejects.toMatchObject({code:'FULFILLMENT_EXTERNAL_SEQUENCE_INVALID'});
  await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',
   {signed:true,payload:evt('IN_PREPARATION','evt_preparation_a')});
  await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',
   {signed:true,payload:evt('READY','evt_ready_b')});
  await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',
   {signed:true,payload:evt('OUT_FOR_DELIVERY','evt_delivery_c')});
  const final=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',
   {signed:true,payload:evt('COMPLETED','evt_complete_d')});
  expect(final.state).toBe('COMPLETED');
  const replay=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',
   {signed:true,payload:evt('IN_PREPARATION','evt_preparation_a')});
  expect(replay.version).toBe(final.version);
  expect(e.operations.events.filter(x=>x.name==='ProductionStarted')).toHaveLength(1);
  expect(await worker.runOnce()).toEqual({claimed:5,delivered:5,retried:0});
  expect(e.notices.map(v=>v.name)).toEqual(['OrderReleasedToProduction','ProductionStarted',
   'OrderReady','DeliveryDispatched','DeliveryCompleted']);
  expect(e.pdv.kitchen.size).toBe(1);
 });
 it('INTEGRATED lost ACK after remote accept retries same key after process restart, never native fallback',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  e.pdv.timeoutOnce=true;
  await e.service.release(ctx(),'main',e.order.id);
  let now=clock;
  const first=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,()=>now);
  expect(await first.runOnce()).toEqual({claimed:1,delivered:0,retried:1});
  expect(e.pdv.kitchen.size).toBe(1);
  now+=31000;
  const afterRestart=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,()=>now);
  expect(await afterRestart.runOnce()).toEqual({claimed:1,delivered:1,retried:0});
  expect(e.pdv.dispatchLog.map(x=>x.idempotencyKey))
   .toEqual([e.pdv.dispatchLog[0].idempotencyKey,e.pdv.dispatchLog[0].idempotencyKey]);
  expect(e.pdv.kitchen.size).toBe(1);
  expect(e.operations.events.filter(x=>x.name==='OrderReleasedToProduction')).toHaveLength(1);
 });
 it('INTEGRATED offline connector DLQ and manual review never sends a second kitchen ticket',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  await e.service.release(ctx(),'main',e.order.id);
  e.pdv.healthy=false;
  let now=clock;
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,()=>now);
  for(let i=0;i<8;i++){expect((await worker.runOnce()).retried).toBe(1);now+=3600000;}
  expect([...e.operations.jobs.values()][0].deliveryStatus).toBe('DLQ');
  expect(e.pdv.dispatchLog).toHaveLength(0);
  const review=await e.service.escalate(ctx(),'main',e.order.id,{
   expectedVersion:1,reason:'Conector indisponível: intervenção supervisionada',
  });
  expect(review).toMatchObject({state:'MANUAL_REVIEW_REQUIRED',
   escalation:{manualDispatchAuthorized:false}});
  expect((await worker.runOnce()).claimed).toBe(0);
 });
 it('mode switch with active operations and non-homologated connector are rejected',async()=>{
  const e=await fixture({mode:'NATIVE_OPERATIONS'});
  await e.service.release(ctx(),'main',e.order.id);
  e.profile.capabilityRegistry.operationMode='INTEGRATED_OPERATIONS';
  await expect(e.service.publishSettings(ctx(),'main',{
   ...config('INTEGRATED_OPERATIONS'),expectedVersion:1,
  })).rejects.toMatchObject({code:'FULFILLMENT_MODE_ACTIVE_ORDERS'});
  expect((await e.settings.get('pizza-a','main'))?.operationMode).toBe('NATIVE_OPERATIONS');
  expect(new EmptyProductionAdapterRegistry().get('PDV_CERTIFIED_TEST')).toBeNull();
  const foreign=await fixture({mode:'INTEGRATED_OPERATIONS'});
  await expect(foreign.service.get(ctx('pizza-b'),'main',foreign.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_NOT_FOUND'});
 });
});

describe('T08.4 — official WhatsApp worker wiring, signed proof and idempotency',()=>{
 function officialFixture(){
  const connection:WhatsAppConnection={tenantId:'pizza-a',unitId:'main',
   phoneNumberId:'123456789000',wabaId:'987654321000',status:'ACTIVE',
   credentialRef:'mounted:mock-vault',version:2,
   createdAt:NOW,updatedAt:NOW};
  const secret:WhatsAppSecrets={tenantId:'pizza-a',unitId:'main',
   phoneNumberId:connection.phoneNumberId,wabaId:connection.wabaId,
   accessToken:'mock-access-not-live',verifyToken:'mock-verify',
   appSecret:'mock-app-signature'};
  let signedInbound=true;
  const records=new Map<string,WhatsAppSendRecord>();
  const graph={send:vi.fn(async()=> 'wamid.mock_sent_001')};
  const delivery=new WhatsAppDeliveryService(
   {get:async(t:string,u:string)=>t==='pizza-a'&&u==='main'?connection:null,
    write:async()=>{}},
   {load:async()=>secret},
   {reserve:async(record:WhatsAppSendRecord)=>{
    const k=JSON.stringify([record.tenantId,record.unitId,record.idempotencyKey]);
    const prior=records.get(k);if(prior)return prior;
    records.set(k,record);return record;
   },settle:async(record:WhatsAppSendRecord)=>{
    records.set(JSON.stringify([record.tenantId,record.unitId,record.idempotencyKey]),record);
   }},
   graph,{hasRecentVerifiedInbound:async()=>signedInbound},
  );
  const people={findById:async(t:string,c:string)=>t==='pizza-a'?
    {tenantId:t,id:c,name:'Cliente',phone:'5511999887766',status:'ACTIVE' as const,
     externalIdentities:[],createdAt:NOW,updatedAt:NOW}:null};
  const identity={get:async(t:string,c:string)=>t==='pizza-a'?
    {tenantId:t,customerId:c,channel:'WHATSAPP' as const,recipient:'5511999887766',
     provenance:'SIGNED_PROVIDER_WEBHOOK' as const,proofRef:'signed-inbound',
     verifiedAt:NOW}:null};
  const notices=new ChannelCustomerNoticePort(new ChannelService([]),
   people as never,identity as never,delivery);
  return {notices,graph,records,setSigned:(v:boolean)=>{signedInbound=v;}};
 }
 it('uses verified inbound, exact tenant/unit and persisted event key for one Meta send on retries',async()=>{
  const e=await fixture();
  const f=officialFixture();
  await e.service.release(ctx(),'main',e.order.id);
  const op=await e.service.get(ctx(),'main',e.order.id);
  const event=e.operations.events[0];
  await f.notices.send(event,op);
  await f.notices.send(event,op);
  expect(f.graph.send).toHaveBeenCalledOnce();
  expect(f.records.size).toBe(1);
  await expect(f.notices.send({...event,tenantId:'pizza-b'},op))
   .rejects.toMatchObject({code:'FULFILLMENT_NOTIFICATION_SCOPE_INVALID'});
  expect(f.graph.send).toHaveBeenCalledOnce();
 });
 it('blocks absent verified WhatsApp inbound window and mismatched tenant',async()=>{
  const e=await fixture();
  const f=officialFixture();
  await e.service.release(ctx(),'main',e.order.id);
  const op=await e.service.get(ctx(),'main',e.order.id);
  const event=e.operations.events[0];
  f.setSigned(false);
  await expect(f.notices.send(event,op))
   .rejects.toMatchObject({code:'WHATSAPP_CUSTOMER_CONSENT_REQUIRED'});
  expect(f.graph.send).not.toHaveBeenCalled();
 });
 it('production never silently falls back to legacy channel sender',async()=>{
  vi.stubEnv('NODE_ENV','production');
  const e=await fixture();
  const f=officialFixture();
  await e.service.release(ctx(),'main',e.order.id);
  const op=await e.service.get(ctx(),'main',e.order.id);
  const event=e.operations.events[0];
  const adapter:ChannelInterface={
   id:'WHATSAPP',sendMessage:vi.fn(async()=>({ok:true,data:{
    channel:'WHATSAPP' as const,externalMessageId:'fake',acceptedAt:NOW,
   }})),validateWebhook:async()=>({ok:true,data:true}),
   normalizeInbound:async()=>({ok:true,data:[]}),
  };
  const fallback=new ChannelCustomerNoticePort(new ChannelService([adapter]),
   {findById:async()=>({tenantId:'pizza-a',id:op.customerId,
    name:'Cliente',phone:'5511999887766',status:'ACTIVE',externalIdentities:[],
    createdAt:NOW,updatedAt:NOW})} as never,
   {get:async()=>({tenantId:'pizza-a',customerId:op.customerId,channel:'WHATSAPP',
    recipient:'5511999887766',provenance:'SIGNED_PROVIDER_WEBHOOK',
    proofRef:'signed-test',verifiedAt:NOW})} as never);
  await expect(fallback.send(event,op))
   .rejects.toMatchObject({code:'FULFILLMENT_OFFICIAL_WHATSAPP_REQUIRED'});
  expect(adapter.sendMessage).not.toHaveBeenCalled();
  vi.stubEnv('ATENDEVENDE_PILOT_LIVE_ENABLED','false');
  await expect(f.notices.send(event,op))
   .rejects.toMatchObject({code:'PILOT_FEATURE_DISABLED'});
  expect(f.graph.send).not.toHaveBeenCalled();
 });
});
