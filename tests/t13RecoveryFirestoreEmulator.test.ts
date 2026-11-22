import {describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {FirestoreStaleGovernanceReceiptStore} from '../src/governance/recovery';
import {FirestoreConfirmedSalesPaymentSource} from '../src/fiscal/recovery';
import type {ToolReceipt} from '../src/governance/model';
import type {Payment} from '../src/payments/model';

const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';
if(enabled&&(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t10'||process.env.NODE_ENV!=='test'))
 throw Error('T13_FIRESTORE_EMULATOR_UNSAFE');
const db=()=>getFirestore(ensureFirebaseAdminApp());

describe.skipIf(!enabled)('T13 governance and fiscal recovery against real Firestore transactions',()=>{
 it('quarantines stale receipts once, rejects cross-tenant and concurrent recovery',async()=>{
  const id='recovery_'+randomUUID().replace(/-/g,'');
  const source:ToolReceipt={
   id,tenantId:'tenant-recovery',unitId:'main',actorId:'operator',
   tool:'PAYMENT_CREATE',requestHash:'immutable-hash',idempotencyKey:id,
   policyVersion:1,status:'RESERVED',
   createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',
  };
  await db().collection('governanceToolReceipts').doc(id).create(source);
  const store=new FirestoreStaleGovernanceReceiptStore();
  const cutoff='2026-11-21T00:00:00.000Z';
  expect(await store.quarantine({...source,tenantId:'other-tenant'},cutoff)).toBe(false);
  const states=await Promise.all([store.quarantine(source,cutoff),store.quarantine(source,cutoff)]);
  expect(states.filter(Boolean)).toHaveLength(1);
  const saved=(await db().collection('governanceToolReceipts').doc(id).get()).data();
  expect(saved).toMatchObject({status:'REVIEW_REQUIRED',
    failureCode:'AUTONOMY_STALE_RESERVATION_REQUIRES_RECONCILIATION'});
  expect(await store.quarantine(source,cutoff)).toBe(false);
 },60000);
 it('scans confirmed settlements and persists/clears only fiscal recovery review incidents',async()=>{
  const id='fiscal_'+randomUUID().replace(/-/g,'');
  const p:Payment={
   id,tenantId:'tenant-recovery',customerId:'customer-fixture',quoteId:'quote-fixture',
   provider:'ASAAS',providerPaymentId:'pay_fixture',method:'PIX',
   status:'CONFIRMED',amountMinor:12000,currency:'BRL',idempotencyKey:id,
   confirmedAt:'2026-11-01T00:00:00.000Z',createdAt:'2026-11-01T00:00:00.000Z',
   updatedAt:'2026-11-01T00:00:00.000Z',
  };
  await db().collection('payments').doc(id).create(p);
  const source=new FirestoreConfirmedSalesPaymentSource();
  const rows=await source.listConfirmed(250);
  expect(rows.some(row=>row.id===id&&row.tenantId==='tenant-recovery')).toBe(true);
  await source.recordFailure(p,'FISCAL_SOURCE_QUOTE_NOT_FOUND');
  const issueId=createHash('sha256').update(JSON.stringify([p.tenantId,p.id])).digest('hex');
  const ref=db().collection('salesFiscalHandoffRecoveryIssues').doc(issueId);
  expect((await ref.get()).data()).toMatchObject({status:'REVIEW_REQUIRED',
   requiresHumanReview:true,reasonCode:'FISCAL_SOURCE_QUOTE_NOT_FOUND'});
  await source.clearFailure(p);
  expect((await ref.get()).data()).toMatchObject({status:'RESOLVED',
   requiresHumanReview:false});
 },60000);
});
