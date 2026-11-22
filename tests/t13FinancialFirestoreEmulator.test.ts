import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {FirestorePaymentRepository} from '../src/payments/firestoreRepository';
import {FirestoreFiscalOutboxRepository} from '../src/fiscal/outbox';
import {FirestoreVerifiedWebhookRecoveryRepository,verifiedWebhookDeliveryId}
 from '../src/payments/webhookRecovery';
import type {Payment} from '../src/payments/model';

const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';
if(enabled&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t10'||process.env.NODE_ENV!=='test'))
 throw Error('T13_FINANCIAL_EMULATOR_SAFETY_CONFIG_INVALID');
const db=()=>getFirestore(ensureFirebaseAdminApp());
const id=()=>randomUUID().replace(/-/g,'');
const payment=(tenantId:string,confirmed=false):Payment=>{
 const key=id(),now=new Date().toISOString();
 return {id:key,tenantId,quoteId:'quote-'+key,customerId:'customer-'+key,
  provider:'ASAAS',providerPaymentId:'pay_'+key,method:'PIX',
  status:confirmed?'CONFIRMED':'PENDING',amountMinor:5500,currency:'BRL',
  idempotencyKey:key,createdAt:now,updatedAt:now,
  ...(confirmed?{confirmedAt:now}:{})};
};
describe.skipIf(!enabled)('T13 Firestore financial/fiscal atomicity and fencing',()=>{
 it('atomically creates payment and one durable fiscal intent, even on concurrent updates',async()=>{
  const repo=new FirestorePaymentRepository(),p=payment('tenant-'+id());
  await repo.create(p);
  expect((await db().collection('paymentFiscalOutbox').doc(p.id).get()).exists).toBe(false);
  const confirmed={...p,status:'CONFIRMED' as const,confirmedAt:new Date().toISOString()};
  const results=await Promise.allSettled(Array.from({length:10},()=>repo.update(confirmed)));
  expect(results.some(r=>r.status==='fulfilled')).toBe(true);
  const persisted=await db().collection('payments').doc(p.id).get();
  const intent=await db().collection('paymentFiscalOutbox').doc(p.id).get();
  expect(persisted.get('status')).toBe('CONFIRMED');
  expect(intent.get('state')).toBe('PENDING');
  expect(intent.get('tenantId')).toBe(p.tenantId);
  expect(intent.get('id')).toBe(p.id);
  await expect(repo.update({...confirmed,status:'PENDING'})).rejects.toThrow('PAYMENT_CONFIRMED_STATUS_REGRESSION');
  expect((await db().collection('paymentFiscalOutbox').doc(p.id).get()).get('state')).toBe('PENDING');
 },60000);
 it('creates fiscal outbox in the same Firestore transaction as an initially confirmed payment',async()=>{
  const repo=new FirestorePaymentRepository(),p=payment('tenant-'+id(),true);
  await repo.create(p);
  const [saved,intent]=await Promise.all([
   db().collection('payments').doc(p.id).get(),
   db().collection('paymentFiscalOutbox').doc(p.id).get()]);
  expect(saved.exists).toBe(true);
  expect(intent.get('tenantId')).toBe(p.tenantId);
 },60000);
 it('backfills old confirmed payments missing an outbox without producing a fictitious invoice',async()=>{
  const p=payment('tenant-'+id(),true);
  await db().collection('payments').doc(p.id).create(p);
  const outbox=new FirestoreFiscalOutboxRepository();
  // Backfill cursor advances through the full confirmed scan.
  let found=false;
  for(let attempt=0;attempt<30;attempt++){
   await outbox.backfillConfirmed(250);
   found=(await db().collection('paymentFiscalOutbox').doc(p.id).get()).exists;
   if(found)break;
  }
  expect(found).toBe(true);
  expect((await db().collection('paymentFiscalOutbox').doc(p.id).get()).get('state')).toBe('PENDING');
 },90000);
 it('only one of ten racing workers can claim and a stale token cannot finish',async()=>{
  const repo=new FirestoreVerifiedWebhookRecoveryRepository(),e={
   tenantId:'tenant-'+id(),provider:'ASAAS',providerPaymentId:'pay_'+id(),eventId:'evt-'+id()};
  const now=Date.now(),key=verifiedWebhookDeliveryId(e);
  await Promise.all(Array.from({length:10},()=>repo.enqueue(e,now)));
  const claims=await Promise.all(Array.from({length:10},()=>repo.claim(key,now)));
  const winners=claims.filter((v):v is string=>typeof v==='string');
  expect(winners).toHaveLength(1);
  await repo.finish(key,now+1,true,'FAKE_STALE','not-the-owner');
  expect(await repo.state(key)).toBe('PENDING');
  await repo.finish(key,now+2,true,'PSP_GET_VERIFIED',winners[0]);
  expect(await repo.state(key)).toBe('COMPLETED');
  expect(await repo.claim(key,now+120_001)).toBe(false);
 },60000);
 it('expired worker cannot complete another worker lease',async()=>{
  const repo=new FirestoreVerifiedWebhookRecoveryRepository(),e={
   tenantId:'tenant-'+id(),provider:'ASAAS',providerPaymentId:'pay_'+id(),eventId:'evt-'+id()};
  const now=Date.now(),key=verifiedWebhookDeliveryId(e);
  await repo.enqueue(e,now);
  const first=await repo.claim(key,now);
  const second=await repo.claim(key,now+120_001);
  expect(typeof first).toBe('string');
  expect(typeof second).toBe('string');
  expect(second).not.toBe(first);
  await repo.finish(key,now+120_002,true,'STALE',String(first));
  expect(await repo.state(key)).toBe('PENDING');
  await repo.finish(key,now+120_003,true,'CURRENT',String(second));
  expect(await repo.state(key)).toBe('COMPLETED');
 },60000);
});
