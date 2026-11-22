import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {FirestoreOrderPaymentOutboxRepository,FirestoreOrderFinancialEventConsumer} from '../src/orderPayments/outbox';
import {FirestoreOrderPaymentReconciliationRepository} from '../src/orderPayments/reconciliation';
import {FirestoreReconciliationRepository} from '../src/payments/reconciliation';
import type {OutboxRecord} from '../src/orderPayments/model';
const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';
if(enabled&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t10'||
 process.env.NODE_ENV!=='test'))throw Error('UNSAFE_FINANCIAL_EMULATOR');
const db=()=>getFirestore(ensureFirebaseAdminApp());

describe.skipIf(!enabled)('T13 finance leases and outbox real Firestore CAS',()=>{
 it('stale delivery cannot mark new claim as DELIVERED; retry and idempotent ledger',async()=>{
  const id='outbox_'+randomUUID().replace(/-/g,'');
  const now=1763800000000;
  const row:OutboxRecord={id,tenantId:'tenant-a',unitId:'main',orderId:'o1',
   paymentId:id,paymentVersion:2,kind:'PAYMENT_CONFIRMED',status:'CONFIRMED',
   amountMinor:5000,method:'PIX',provider:'ASAAS',occurredAt:new Date(now).toISOString(),
   deliveryStatus:'PENDING',attemptCount:0,nextAttemptAt:now-1,leaseUntil:0,
   updatedAt:new Date(now).toISOString(),verificationSource:'PSP_GET'};
  const ref=db().collection('orderPaymentOutbox').doc(id);
  await ref.create(row);
  const outbox=new FirestoreOrderPaymentOutboxRepository();
  const first=(await outbox.claim(now,100)).find(x=>x.id===id);
  expect(first?.claimToken).toMatch(/^[a-f0-9-]{36}$/);
  // Another claimed read during first lease cannot duplicate the event.
  expect((await outbox.claim(now+1,100)).find(x=>x.id===id)).toBeUndefined();
  await outbox.retry(id,first!.claimToken!,now+2,'TEMPORARY_FAILURE',8);
  expect((await ref.get()).get('deliveryStatus')).toBe('PENDING');
  const retryAt=(await ref.get()).get('nextAttemptAt') as number;
  const second=(await outbox.claim(retryAt+1,100)).find(x=>x.id===id);
  expect(second).toBeDefined();
  await outbox.delivered(id,first!.claimToken!,retryAt+2);
  expect((await ref.get()).get('deliveryStatus')).toBe('PROCESSING');
  const sink=new FirestoreOrderFinancialEventConsumer();
  await sink.publish(second!);
  await sink.publish(second!);
  const saved=(await db().collection('commercialFinancialEvents').doc(id).get()).data();
  expect(saved).toMatchObject({tenantId:'tenant-a',paymentId:id,
   collectedMinor:5000,refundedMinor:0,settlementEvidenceKind:'PSP_GET'});
  await outbox.delivered(id,second!.claimToken!,retryAt+3);
  expect((await ref.get()).get('deliveryStatus')).toBe('DELIVERED');
 },60000);
 it('legacy and order payment reconciler prevent stale lease finalization',async()=>{
  const id='lease_'+randomUUID().replace(/-/g,'');
  const a=new FirestoreReconciliationRepository();
  const first=await a.claim(id,1);
  expect(typeof first).toBe('string');
  expect(await a.claim(id,119999)).toBe(false);
  const second=await a.claim(id,120002);
  expect(second).not.toBe(first);
  expect(await a.finish(id,120003,true,String(first))).toBe(false);
  expect(await a.finish(id,120004,true,String(second))).toBe(true);
  const b=new FirestoreOrderPaymentReconciliationRepository();
  const ofirst=await b.claim(id,1);
  expect(typeof ofirst).toBe('string');
  expect(await b.claim(id,119999)).toBe(false);
  const osecond=await b.claim(id,120002);
  expect(osecond).not.toBe(ofirst);
  expect(await b.finish(id,120003,true,'PSP_OK',String(ofirst))).toBe(false);
  expect(await b.finish(id,120004,true,'PSP_OK',String(osecond))).toBe(true);
 },60000);
});
