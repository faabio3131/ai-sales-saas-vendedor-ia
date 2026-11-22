import {describe,it,expect} from 'vitest';
import type {VerifiedProductionStatus,ProductionDispatchAck,OperationEventName} from '../src/fulfillment/model';
import {FulfillmentWorker,EmptyProductionAdapterRegistry} from '../src/fulfillment/worker';
import {ctx,fixture,NOW} from './helpers/t06Fixtures';

const time=Date.parse(NOW);
async function verifiedStatus(input:{
 tenantId?:string;unitId?:string;connectorId?:string;
 orderId:string;correlationId:string;externalOrderId:string;
 status:VerifiedProductionStatus['status'];providerEventId:string;
}):Promise<VerifiedProductionStatus>{
 return {tenantId:input.tenantId??'pizza-a',unitId:input.unitId??'main',
  connectorId:input.connectorId??'PDV_CERTIFIED_TEST',orderId:input.orderId,
  correlationId:input.correlationId,externalOrderId:input.externalOrderId,
  status:input.status,providerEventId:input.providerEventId,
  proofRef:'adapter-verified-signature-ref'};
}
describe('T06 — integrated PDV/KDS versioned production port',()=>{
 it('sends exactly one scoped versioned ticket and requires ACK before releasing production',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  const pending=await e.service.release(ctx(),'main',e.order.id);
  expect(pending).toMatchObject({
   operationMode:'INTEGRATED_OPERATIONS',state:'AWAITING_ACK',
   productionState:'AWAITING_ACK',deliveryState:'NOT_STARTED',version:1,
  });
  expect(e.operations.events.map(x=>x.name)).toEqual(['ProductionDispatchRequested']);
  expect(e.operations.jobs.size).toBe(1);
  expect(e.pdv.kitchen.size).toBe(0);
  await expect(e.service.advanceNative(ctx(),'main',pending.orderId,{
   expectedVersion:1,action:'START',
  })).rejects.toMatchObject({code:'FULFILLMENT_NATIVE_ACTION_FORBIDDEN'});
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,
   ()=>time);
  expect(await worker.runOnce()).toEqual({claimed:1,delivered:1,retried:0});
  expect(e.pdv.kitchen.size).toBe(1);
  expect(e.pdv.dispatchLog).toHaveLength(1);
  const payload=e.pdv.dispatchLog[0];
  expect(payload).toMatchObject({
   schemaVersion:1,tenantId:'pizza-a',unitId:'main',orderId:pending.orderId,
   orderNumber:pending.orderNumber,customerId:pending.customerId,
   correlationId:pending.correlationId,idempotencyKey:pending.dispatchIdempotencyKey,
   operationMode:'INTEGRATED_OPERATIONS',
  });
  expect(payload.lines[0]).toMatchObject({
   name:'Pizza Grande',quantity:1,
   size:{name:'Grande'},flavors:[{name:'Calabresa'}],
  });
  expect((await e.service.get(ctx(),'main',pending.orderId))).toMatchObject({
   state:'QUEUED',version:2,externalOrderId:'pdv_external_1',
  });
  expect(e.operations.orders.get(e.operations.key('pizza-a','main',pending.orderId)))
   .toMatchObject({productionState:'QUEUED',deliveryState:'NOT_STARTED'});
  expect(e.operations.events.map(x=>x.name)).toEqual([
   'ProductionDispatchRequested','OrderReleasedToProduction',
  ]);
  expect(await e.service.release(ctx(),'main',pending.orderId))
   .toMatchObject({state:'QUEUED',version:2});
  expect(e.pdv.kitchen.size).toBe(1);
  expect(e.notices).toHaveLength(0);
 });
 it('handles lost ACK after external acceptance with exactly the same ticket key',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  e.pdv.timeoutOnce=true;
  await e.service.release(ctx(),'main',e.order.id);
  let now=time;
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,
    ()=>now);
  expect(await worker.runOnce()).toEqual({claimed:1,delivered:0,retried:1});
  expect(e.pdv.kitchen.size).toBe(1);
  expect((await e.service.get(ctx(),'main',e.order.id)).state).toBe('AWAITING_ACK');
  now+=31000;
  expect(await worker.runOnce()).toEqual({claimed:1,delivered:1,retried:0});
  expect(e.pdv.dispatchLog).toHaveLength(2);
  expect(e.pdv.dispatchLog[0].idempotencyKey).toBe(e.pdv.dispatchLog[1].idempotencyKey);
  expect(e.pdv.kitchen.size).toBe(1);
  expect((await e.service.get(ctx(),'main',e.order.id)).state).toBe('QUEUED');
  expect(e.operations.events.filter(x=>x.name==='OrderReleasedToProduction')).toHaveLength(1);
 });
 it('accepts only verified, ordered and deduplicated external status events',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  await e.service.release(ctx(),'main',e.order.id);
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,
    ()=>time);
  await worker.runOnce();
  const first=await e.service.get(ctx(),'main',e.order.id);
  const msg=(status:VerifiedProductionStatus['status'],id:string)=>
   verifiedStatus({orderId:e.order.id,correlationId:first.correlationId,
    externalOrderId:'pdv_external_1',status,providerEventId:id});
  const readyTooEarly=await msg('READY','evt_r_early');
  await expect(e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:true,payload:readyTooEarly,
  })).rejects.toMatchObject({code:'FULFILLMENT_EXTERNAL_SEQUENCE_INVALID'});
  const preparing=await msg('IN_PREPARATION','evt_1');
  await expect(e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:false,payload:preparing,
  })).rejects.toMatchObject({code:'UNVERIFIED_INTEGRATION_EVENT'});
  const inPrep=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:true,payload:preparing,
  });
  expect(inPrep).toMatchObject({state:'IN_PREPARATION',version:3});
  const replay=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:true,payload:preparing,
  });
  expect(replay.version).toBe(3);
  expect(e.operations.events.filter(x=>x.name==='ProductionStarted')).toHaveLength(1);
  const ready=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:true,payload:await msg('READY','evt_2'),
  });
  expect(ready.state).toBe('READY');
  // Retry of an old, already-verified provider event must not fail after a
  // newer status (lastVerifiedExternalEventId) displaced its cached ID.
  const oldReplay=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:true,payload:preparing,
  });
  expect(oldReplay.version).toBe(ready.version);
  expect(e.operations.events.filter(x=>x.name==='ProductionStarted')).toHaveLength(1);
  const dispatched=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:true,payload:await msg('OUT_FOR_DELIVERY','evt_3'),
  });
  expect(dispatched).toMatchObject({state:'OUT_FOR_DELIVERY',
    productionState:'READY',deliveryState:'OUT_FOR_DELIVERY'});
  const completed=await e.service.verifyAndApply(e.pdv.id,'pizza-a','main',{
    signed:true,payload:await msg('COMPLETED','evt_4'),
  });
  expect(completed).toMatchObject({state:'COMPLETED',deliveryState:'COMPLETED'});
  const history=e.operations.events.map(x=>x.name);
  expect(history).toEqual([
   'ProductionDispatchRequested','OrderReleasedToProduction',
   'ProductionStarted','OrderReady','DeliveryDispatched','DeliveryCompleted',
  ] satisfies OperationEventName[]);
  expect(e.notices).toHaveLength(0);
  const sent=await worker.runOnce();
  expect(sent).toEqual({claimed:5,delivered:5,retried:0});
  expect(e.notices.map(x=>x.name)).toEqual([
   'OrderReleasedToProduction','ProductionStarted','OrderReady','DeliveryDispatched','DeliveryCompleted',
  ]);
  expect((await e.settings.get('pizza-a','main'))?.activeOperations).toBe(0);
 });
 it('blocks wrong connector, tenant, unit, payment mode, ACK proof or external ID',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  const op=await e.service.release(ctx(),'main',e.order.id);
  const accepted:ProductionDispatchAck={
   schemaVersion:1,tenantId:'pizza-a',unitId:'main',orderId:op.orderId,
   correlationId:op.correlationId,idempotencyKey:op.dispatchIdempotencyKey,
   connectorId:e.pdv.id,accepted:true,
   externalOrderId:'pdv_external_1',proofRef:'signed-ack',
  };
  for(const changed of [
   {...accepted,idempotencyKey:'other-order'},
   {...accepted,tenantId:'pizza-b'},
   {...accepted,unitId:'other-unit'},
   {...accepted,accepted:false},
   {...accepted,externalOrderId:''},
  ]){
   await expect(e.service.acknowledge('pizza-a','main',op.orderId,changed))
    .rejects.toMatchObject({code:'FULFILLMENT_ACK_UNVERIFIED'});
  }
  expect(e.operations.events).toHaveLength(1);
  await expect(e.service.verifyAndApply('other-connector','pizza-a','main',{
    signed:true,payload:accepted,
  })).rejects.toMatchObject({code:'FULFILLMENT_CONNECTOR_NOT_REGISTERED'});
  expect((await e.service.get(ctx(),'main',op.orderId)).state).toBe('AWAITING_ACK');
  const correct=await e.service.acknowledge('pizza-a','main',op.orderId,accepted);
  expect(correct).toMatchObject({state:'QUEUED',version:2});
  const duplicated=await e.service.acknowledge('pizza-a','main',op.orderId,accepted);
  expect(duplicated.version).toBe(2);
  expect(e.operations.events.filter(x=>x.name==='OrderReleasedToProduction')).toHaveLength(1);
 });
 it('does not fall back to native kitchen after ambiguous integrated failure',async()=>{
  const e=await fixture({mode:'INTEGRATED_OPERATIONS'});
  e.pdv.healthy=false;
  await expect(e.service.release(ctx(),'main',e.order.id))
   .rejects.toMatchObject({code:'FULFILLMENT_CONNECTOR_NOT_VERIFIED'});
  e.pdv.healthy=true;
  await e.service.release(ctx(),'main',e.order.id);
  e.pdv.healthy=false;
  let now=time;
  const worker=new FulfillmentWorker(e.operations,e.operations,e.service,e.adapters,e.sender,
    ()=>now);
  for(let i=0;i<8;i++){
   const result=await worker.runOnce();
   expect(result.retried).toBe(1);
   now+=60*60*1000;
  }
  expect([...e.operations.jobs.values()][0].deliveryStatus).toBe('DLQ');
  expect(e.pdv.kitchen.size).toBe(0);
  await expect(e.service.escalate(ctx('pizza-a','STAFF'),'main',e.order.id,{
    expectedVersion:1,reason:'Revisar conexão',
  })).rejects.toMatchObject({code:'FULFILLMENT_ROLE_DENIED'});
  const review=await e.service.escalate(ctx(),'main',e.order.id,{
    expectedVersion:1,reason:'PDV sem ACK: conferir se o pedido foi recebido',
  });
  expect(review).toMatchObject({
   state:'MANUAL_REVIEW_REQUIRED',
   escalation:{manualDispatchAuthorized:false,requestedBy:'operator'},
  });
  expect(e.operations.events.at(-1)?.name).toBe('ProductionDispatchEscalated');
  expect(e.pdv.kitchen.size).toBe(0);
  expect(await worker.runOnce()).toMatchObject({claimed:0});
 });
 it('defaults to no live connector and cannot mark any integrated order as acknowledged',()=>{
  const empty=new EmptyProductionAdapterRegistry();
  expect(empty.get('PDV_CERTIFIED_TEST')).toBeNull();
  expect(empty.get('anything')).toBeNull();
 });
});
