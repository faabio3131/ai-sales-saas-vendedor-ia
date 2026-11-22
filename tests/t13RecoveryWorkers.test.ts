import {describe,it,expect,vi} from 'vitest';
import type {ToolReceipt} from '../src/governance/model';
import {GovernedReceiptRecoveryWorker} from '../src/governance/recovery';
import type {StaleGovernanceReceiptStore} from '../src/governance/recovery';
import {FiscalHandoffRecoveryWorker} from '../src/fiscal/recovery';
import type {ConfirmedSalesPaymentSource} from '../src/fiscal/recovery';
import type {Payment} from '../src/payments/model';

const oldTime='2026-11-01T00:00:00.000Z';
const recent='2026-11-22T14:59:00.000Z';
function receipt(id:string,updatedAt:string):ToolReceipt {
 return {id,tenantId:'tenant-a',unitId:'unit-a',actorId:'operator-a',
  tool:'PAYMENT_CREATE',requestHash:'abc',idempotencyKey:id,
  policyVersion:1,status:'RESERVED',createdAt:oldTime,updatedAt};
}
function payment(status:Payment['status'],id:string):Payment{
 return {id,tenantId:'tenant-a',customerId:'customer-a',quoteId:'quote-a',
  provider:'ASAAS',providerPaymentId:'pay_'+id,method:'PIX',
  status,amountMinor:12000,currency:'BRL',idempotencyKey:id,
  confirmedAt:oldTime,createdAt:oldTime,updatedAt:oldTime};
}
describe('T13 governance and fiscal recovery remain fail-safe',()=>{
 it('only quarantines stale RESERVED receipts and never invokes side effects',async()=>{
  const rows=[receipt('old',oldTime),receipt('recent',recent)];
  const quarantined:string[]=[];
  const store:StaleGovernanceReceiptStore={
   listReserved:async()=>rows,
   quarantine:async(row,before)=>{
    if(row.updatedAt>before)return false;
    quarantined.push(row.id);row.status='REVIEW_REQUIRED';return true;
   },
  };
  const worker=new GovernedReceiptRecoveryWorker(store,
   ()=>Date.parse('2026-11-22T15:00:00.000Z'));
  expect(await worker.runOnce(100)).toEqual({scanned:2,quarantined:1,skipped:1,failed:0});
  expect(quarantined).toEqual(['old']);
  expect(rows[0].status).toBe('REVIEW_REQUIRED');
  expect(rows[1].status).toBe('RESERVED');
 });
 it('retries the immutable confirmed payment -> fiscal handoff, never fabricates a settlement',async()=>{
  const sourceRows=[payment('CONFIRMED','verified'),payment('PENDING','not-paid')];
  const failed:string[]=[],cleared:string[]=[];
  const source:ConfirmedSalesPaymentSource={
   listConfirmed:async()=>sourceRows,
   recordFailure:async(p,code)=>{failed.push(p.id+':'+code);},
   clearFailure:async p=>{cleared.push(p.id);},
  };
  let fail=true;
  const observer={onConfirmed:vi.fn(async(p:Payment)=>{
   if(p.id==='verified'&&fail)throw Error('transient firestore failure');
  })};
  const worker=new FiscalHandoffRecoveryWorker(source,observer);
  expect(await worker.runOnce()).toEqual({scanned:2,confirmed:0,failed:1,skipped:1});
  expect(failed).toEqual(['verified:FISCAL_RECOVERY_UNEXPECTED']);
  fail=false;
  expect(await worker.runOnce()).toEqual({scanned:2,confirmed:1,failed:0,skipped:1});
  expect(cleared).toEqual(['verified']);
  expect(observer.onConfirmed).toHaveBeenCalledTimes(2);
  expect(observer.onConfirmed).not.toHaveBeenCalledWith(sourceRows[1]);
 });
});
