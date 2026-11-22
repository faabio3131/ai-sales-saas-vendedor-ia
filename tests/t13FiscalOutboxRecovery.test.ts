import {describe,it,expect,vi} from 'vitest';
import {FiscalHandoffReconciliationWorker} from '../src/fiscal/outbox';
import type {FiscalOutboxEntry,FiscalOutboxStore} from '../src/fiscal/outbox';
import type {Payment} from '../src/payments/model';

const now=1_700_000_000_000;
const entry: FiscalOutboxEntry={id:'payment-1',tenantId:'tenant-a',state:'PENDING',
 createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),
 nextAttemptAt:0,leaseUntil:0,attempts:0};
const payment={id:'payment-1',tenantId:'tenant-a',status:'CONFIRMED',
 confirmedAt:new Date(now).toISOString()} as Payment;
function fixture(){
 const store: FiscalOutboxStore={
  backfillConfirmed:vi.fn().mockResolvedValue({scanned:1,created:1}),
  due:vi.fn().mockResolvedValue([entry]),
  claim:vi.fn().mockResolvedValue('fence-1'),
  confirmedPayment:vi.fn().mockResolvedValue(payment),
  finish:vi.fn().mockResolvedValue(true),
 };
 const observer={onConfirmed:vi.fn().mockResolvedValue(undefined)};
 return {store,observer,worker:new FiscalHandoffReconciliationWorker(store,observer,()=>now)};
}
describe('T13 fiscal recovery (no payment replay)',()=>{
 it('reconciles a confirmed payment after backfilling a missing handoff',async()=>{
  const {store,observer,worker}=fixture();
  const outcome=await worker.runOnce();
  expect(outcome).toEqual({scanned:1,created:1,queued:1,completed:1,failed:0,skipped:0});
  expect(observer.onConfirmed).toHaveBeenCalledExactlyOnceWith(payment);
  expect(store.finish).toHaveBeenCalledWith('payment-1','tenant-a','fence-1',now,true,'FISCAL_HANDOFF_RECORDED');
 });
 it('does not invoke fiscal callback when another worker owns the lease',async()=>{
  const {store,observer,worker}=fixture();
  vi.mocked(store.claim).mockResolvedValue(false);
  const summary=await worker.runOnce();
  expect(summary.skipped).toBe(1);
  expect(observer.onConfirmed).not.toHaveBeenCalled();
 });
 it('does not treat a missing confirmed payment as successful',async()=>{
  const {store,observer,worker}=fixture();
  vi.mocked(store.confirmedPayment).mockResolvedValue(null);
  const summary=await worker.runOnce();
  expect(summary.failed).toBe(1);
  expect(observer.onConfirmed).not.toHaveBeenCalled();
  expect(store.finish).toHaveBeenCalledWith('payment-1','tenant-a','fence-1',now,false,'FISCAL_HANDOFF_RETRY_REQUIRED');
 });
 it('retains failed handoffs for fenced retry rather than replaying payment',async()=>{
  const {store,observer,worker}=fixture();
  observer.onConfirmed.mockRejectedValueOnce(new Error('Firestore unavailable'));
  const summary=await worker.runOnce();
  expect(summary.failed).toBe(1);
  expect(store.finish).toHaveBeenCalledWith('payment-1','tenant-a','fence-1',now,false,'FISCAL_HANDOFF_RETRY_REQUIRED');
 });
 it('does not count a stale worker as completed when fencing rejects finish',async()=>{
  const {store,worker}=fixture();
  vi.mocked(store.finish).mockResolvedValue(false);
  const summary=await worker.runOnce();
  expect(summary.completed).toBe(0);
  expect(summary.skipped).toBe(1);
 });
});
