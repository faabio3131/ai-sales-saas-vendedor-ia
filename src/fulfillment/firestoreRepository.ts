import {createHash,randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {Order} from '../orders/model';
import type {OrderPayment} from '../orderPayments/model';
import {rejected} from './policy';
import type {UnitFulfillmentSettings,FulfillmentSettingsRepository,OperationRepository,
  OperationRecord,OperationEvent,OperationOutboxItem,OperationOutboxRepository} from './model';

const database=()=>getFirestore(ensureFirebaseAdminApp());
const hash=(...parts:string[])=>createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const settingsRef=(t:string,u:string)=>database().collection('unitFulfillmentSettings').doc(hash(t,u));
const operationRef=(t:string,u:string,o:string)=>database().collection('productionOperations').doc(hash(t,u,o));
const orderRef=(id:string)=>database().collection('orders').doc(id);
const eventRef=(event:OperationEvent)=>database().collection('productionEvents').doc(event.id);
function outboxFor(event:OperationEvent,work:'DISPATCH'|'CUSTOMER_NOTICE'):OperationOutboxItem{
 return {...event,work,deliveryStatus:'PENDING',attemptCount:0,nextAttemptAt:0,leaseUntil:0};
}
export class FirestoreFulfillmentSettingsRepository implements FulfillmentSettingsRepository{
 async get(t:string,u:string):Promise<UnitFulfillmentSettings|null>{
  const data=(await settingsRef(t,u).get()).data() as UnitFulfillmentSettings|undefined;
  return data?.tenantId===t&&data.unitId===u?data:null;
 }
 async publish(next:UnitFulfillmentSettings,expectedVersion:number):Promise<UnitFulfillmentSettings>{
  const ref=settingsRef(next.tenantId,next.unitId);
  return database().runTransaction(async tx=>{
   const old=(await tx.get(ref)).data() as UnitFulfillmentSettings|undefined;
   if((old&&(old.tenantId!==next.tenantId||old.unitId!==next.unitId))||
     (old?.version??0)!==expectedVersion||next.version!==expectedVersion+1)
     rejected('FULFILLMENT_SETTINGS_VERSION_CONFLICT');
   if(old&&old.operationMode!==next.operationMode&&old.activeOperations>0)
     rejected('FULFILLMENT_MODE_ACTIVE_ORDERS');
   const saved={...next,activeOperations:old?.activeOperations??0};
   tx.set(ref,saved);
   return saved;
  });
 }
}
export class FirestoreOperationRepository implements OperationRepository{
 async get(t:string,u:string,o:string):Promise<OperationRecord|null>{
  const data=(await operationRef(t,u,o).get()).data() as OperationRecord|undefined;
  return data?.tenantId===t&&data.unitId===u&&data.orderId===o?data:null;
 }
 async list(t:string,u:string):Promise<OperationRecord[]>{
  // Only active tickets belong to the operational queue. Counting every
  // historical COMPLETED ticket eventually made the KDS unusable after 500
  // lifetime orders, even when no kitchen work remained.
  const active=['AWAITING_ACK','QUEUED','IN_PREPARATION','READY',
    'OUT_FOR_DELIVERY','MANUAL_REVIEW_REQUIRED'];
  const all=await database().collection('productionOperations')
   .where('tenantId','==',t).where('unitId','==',u)
   .where('state','in',active).limit(500).get();
  if(all.size===500)rejected('FULFILLMENT_QUEUE_LIMIT_REACHED');
  return all.docs.map(d=>d.data() as OperationRecord)
   .filter(o=>o.tenantId===t&&o.unitId===u)
   .sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 }
 async hasActive(t:string,u:string):Promise<boolean>{
  const config=(await settingsRef(t,u).get()).data() as UnitFulfillmentSettings|undefined;
  if(config&&config.activeOperations>0)return true;
  const operations=await this.list(t,u);
  return operations.some(o=>o.state!=='COMPLETED');
 }
 async start(next:OperationRecord,event:OperationEvent,work:'DISPATCH'|'CUSTOMER_NOTICE'):
 Promise<OperationRecord>{
  const op=operationRef(next.tenantId,next.unitId,next.orderId);
  const order=orderRef(next.orderId),settings=settingsRef(next.tenantId,next.unitId);
  const index=database().collection('orderPaymentByOrder').doc(hash(next.tenantId,next.unitId,next.orderId));
  return database().runTransaction(async tx=>{
   const profileRoot=database().collection('businessProfiles')
     .doc(hash(next.tenantId,next.unitId));
   const effectiveProfile=profileRoot.collection('versions')
     .where('effectiveFrom','<=',next.updatedAt)
     .orderBy('effectiveFrom','desc').limit(1);
   const [existing,ord,conf,idx,profileResults]=await Promise.all([
    tx.get(op),tx.get(order),tx.get(settings),tx.get(index),tx.get(effectiveProfile),
   ]);
   const activeProfile=profileResults.docs[0]?.data() as
     import('../business/model').BusinessProfileRevision|undefined;
   if(!activeProfile||activeProfile.tenantId!==next.tenantId||
     activeProfile.unitId!==next.unitId||
     (activeProfile.expiresAt&&activeProfile.expiresAt<=next.updatedAt)||
     activeProfile.capabilityRegistry.operationMode!==next.operationMode||
     !activeProfile.capabilityRegistry.capabilities.includes('PRODUCTION')||
     (next.fulfillment.kind==='DELIVERY'&&
      !activeProfile.capabilityRegistry.capabilities.includes('DELIVERY')))
     rejected('FULFILLMENT_PROFILE_CHANGED_DURING_RELEASE');
   const previous=existing.data() as OperationRecord|undefined;
   if(previous){
    if(previous.tenantId!==next.tenantId||previous.unitId!==next.unitId||
      previous.orderId!==next.orderId||previous.dispatchIdempotencyKey!==next.dispatchIdempotencyKey)
      rejected('FULFILLMENT_OPERATION_COLLISION');
    return previous; // no duplicate kitchen release on retries
   }
   const original=ord.data() as Order|undefined;
   const policy=conf.data() as UnitFulfillmentSettings|undefined;
   if(!original||original.tenantId!==next.tenantId||original.unitId!==next.unitId||
     original.customerId!==next.customerId||original.orderNumber!==next.orderNumber||
     original.status!=='CONFIRMED'||original.productionState!=='NOT_DISPATCHED'||
     original.operationMode!==next.operationMode)
     rejected('FULFILLMENT_ORDER_NOT_RELEASABLE');
   if(!policy||policy.tenantId!==next.tenantId||policy.unitId!==next.unitId||
     policy.version!==next.settingsVersion||policy.operationMode!==next.operationMode)
     rejected('FULFILLMENT_CONFIGURATION_CHANGED');
   if(!idx.exists||idx.get('tenantId')!==next.tenantId||
     idx.get('unitId')!==next.unitId)rejected('FULFILLMENT_PAYMENT_REQUIRED');
   const pRef=database().collection('orderPayments').doc(String(idx.get('paymentId')));
   const p=(await tx.get(pRef)).data() as OrderPayment|undefined;
   if(!p||p.tenantId!==next.tenantId||p.unitId!==next.unitId||
     p.orderId!==next.orderId||p.customerId!==next.customerId||
     p.amountMinor!==original.totalMinor)
     rejected('FULFILLMENT_PAYMENT_SCOPE_MISMATCH');
   const paid=p.status==='CONFIRMED'&&original.paymentState==='CONFIRMED'&&
     (p.verificationSource==='PSP_GET'||p.verificationSource==='OPERATOR_COD');
   let authorizedCOD=false;
   if(p.status==='PENDING'&&original.paymentState==='PENDING'&&
     ['CASH_ON_DELIVERY','CARD_ON_DELIVERY'].includes(p.method)){
    const enabled=await tx.get(database().collection('paymentMethodSettings').doc(next.tenantId));
    authorizedCOD=enabled.get('tenantId')===next.tenantId&&
      (p.method==='CASH_ON_DELIVERY'?enabled.get('cashOnDeliveryEnabled')===true:
        enabled.get('cardOnDeliveryEnabled')===true);
   }
   if(!paid&&!authorizedCOD)rejected('FULFILLMENT_PAYMENT_NOT_SETTLED_OR_AUTHORIZED');
   if(next.version!==1||policy.activeOperations>=100000)
     rejected('FULFILLMENT_VERSION_OR_CAPACITY');
   // All writes are atomic: order projection, operation, config counter,
   // append-only event and reliable dispatch/notification job.
   tx.create(op,next);
   tx.set(order,{...original,version:original.version+1,
     productionState:next.productionState,deliveryState:next.deliveryState,
     updatedAt:next.updatedAt});
   tx.set(settings,{...policy,activeOperations:policy.activeOperations+1});
   tx.create(eventRef(event),event);
   tx.create(database().collection('productionOutbox').doc(event.id),outboxFor(event,work));
   return next;
  });
 }
 async advance(next:OperationRecord,expectedVersion:number,event:OperationEvent,
  work?:'CUSTOMER_NOTICE',inboxKey?:string):Promise<OperationRecord>{
  const op=operationRef(next.tenantId,next.unitId,next.orderId);
  const order=orderRef(next.orderId),setting=settingsRef(next.tenantId,next.unitId);
  const inbox=inboxKey?database().collection('productionInbox')
    .doc(hash(next.tenantId,next.unitId,next.orderId,inboxKey)):null;
  return database().runTransaction(async tx=>{
   const reads=await Promise.all([
    tx.get(op),tx.get(order),tx.get(setting),...(inbox?[tx.get(inbox)]:[]),
   ]);
   const previous=reads[0].data() as OperationRecord|undefined;
   const original=reads[1].data() as Order|undefined;
   const policy=reads[2].data() as UnitFulfillmentSettings|undefined;
   if(inbox&&reads[3]?.exists){
    if(previous&&previous.tenantId===next.tenantId&&previous.unitId===next.unitId)
      return previous;
    rejected('FULFILLMENT_INBOX_SCOPE_CONFLICT');
   }
   if(!previous||!original||!policy||previous.version!==expectedVersion||
     next.version!==expectedVersion+1||previous.tenantId!==next.tenantId||
     previous.unitId!==next.unitId||previous.orderId!==next.orderId||
     previous.operationMode!==next.operationMode||
     previous.customerId!==next.customerId||
     previous.dispatchIdempotencyKey!==next.dispatchIdempotencyKey||
     previous.correlationId!==next.correlationId||
     original.tenantId!==next.tenantId||original.unitId!==next.unitId||
     original.status!=='CONFIRMED'||policy.activeOperations<=0)
     rejected('FULFILLMENT_OPERATION_VERSION_CONFLICT');
   if(original.paymentState==='REFUNDED'||original.paymentState==='REFUND_PENDING')
     rejected('FULFILLMENT_PAYMENT_REFUND_HOLD');
   if(next.state==='COMPLETED'&&previous.state==='COMPLETED')
     rejected('FULFILLMENT_ALREADY_COMPLETED');
   tx.set(op,next);
   tx.set(order,{...original,version:original.version+1,
     productionState:next.productionState,deliveryState:next.deliveryState,
     updatedAt:next.updatedAt});
   if(next.state==='COMPLETED')
     tx.set(setting,{...policy,activeOperations:policy.activeOperations-1});
   tx.create(eventRef(event),event);
   if(work)tx.create(database().collection('productionOutbox').doc(event.id),
     outboxFor(event,work));
   if(inboxKey&&inbox)tx.create(inbox,{tenantId:next.tenantId,unitId:next.unitId,
     orderId:next.orderId,version:next.version,eventId:event.id,receivedAt:next.updatedAt});
   return next;
  });
 }
 async markEscalation(next:OperationRecord,expectedVersion:number,event:OperationEvent):
  Promise<OperationRecord>{
  return this.advance(next,expectedVersion,event);
 }
}
export class FirestoreOperationOutboxRepository implements OperationOutboxRepository{
 async claim(now:number,limit:number):Promise<OperationOutboxItem[]>{
  const max=Math.max(1,Math.min(100,Math.floor(limit)));
  // Fetch only jobs that are actually due. A bounded scan over all PENDING
  // rows can be permanently starved by delayed retries; an expired lease must
  // also be recoverable even while new jobs keep arriving.
  const [pending,expired]=await Promise.all([
    database().collection('productionOutbox')
      .where('deliveryStatus','==','PENDING')
      .where('nextAttemptAt','<=',now)
      .orderBy('nextAttemptAt','asc').limit(max).get(),
    database().collection('productionOutbox')
      .where('deliveryStatus','==','PROCESSING')
      .where('leaseUntil','<=',now)
      .orderBy('leaseUntil','asc').limit(max).get(),
  ]);
  // Alternate new work with abandoned leases so neither queue can starve.
  const rows:typeof pending.docs=[];
  for(let i=0;i<max;i++){
    if(pending.docs[i])rows.push(pending.docs[i]);
    if(expired.docs[i])rows.push(expired.docs[i]);
  }
  const output:OperationOutboxItem[]=[];
  for(const row of rows){
   if(output.length>=max)break;
   const token=randomUUID();
   const claimed=await database().runTransaction(async tx=>{
    const current=(await tx.get(row.ref)).data() as OperationOutboxItem|undefined;
    if(!current||!['PENDING','PROCESSING'].includes(current.deliveryStatus)||
      current.nextAttemptAt>now||current.leaseUntil>now)return null;
    const next={...current,deliveryStatus:'PROCESSING' as const,
      claimToken:token,leaseUntil:now+120000};
    tx.set(row.ref,next);return next;
   });
   if(claimed)output.push(claimed);
  }
  return output;
 }
 async ack(id:string,token:string,now:number):Promise<void>{
  const ref=database().collection('productionOutbox').doc(id);
  await database().runTransaction(async tx=>{
   const previous=(await tx.get(ref)).data() as OperationOutboxItem|undefined;
   if(!previous||previous.deliveryStatus!=='PROCESSING'||previous.claimToken!==token)return;
   tx.set(ref,{...previous,deliveryStatus:'DELIVERED',claimToken:'',leaseUntil:0,
     nextAttemptAt:now});
  });
 }
 async retry(id:string,token:string,now:number,code:string,maxAttempts:number):Promise<void>{
  const ref=database().collection('productionOutbox').doc(id);
  await database().runTransaction(async tx=>{
   const previous=(await tx.get(ref)).data() as OperationOutboxItem|undefined;
   if(!previous||previous.deliveryStatus!=='PROCESSING'||previous.claimToken!==token)return;
   const tries=previous.attemptCount+1,dead=tries>=maxAttempts;
   const delay=Math.min(3600000,30000*2**Math.min(tries,6));
   tx.set(ref,{...previous,deliveryStatus:dead?'DLQ':'PENDING',
     attemptCount:tries,claimToken:'',leaseUntil:0,
     nextAttemptAt:dead?Number.MAX_SAFE_INTEGER:now+delay,
     lastErrorCode:code.slice(0,80)});
  });
 }
}
