import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import type { OutboxRecord,OutboxRepository,FinancialEventConsumer } from './model';

const database=()=>getFirestore(ensureFirebaseAdminApp());
export class FirestoreOrderPaymentOutboxRepository implements OutboxRepository {
  async claim(now:number,limit:number):Promise<OutboxRecord[]> {
    const db=database();
    const max=Math.min(100,Math.max(1,Math.floor(limit)));
    const snapshot=await db.collection('orderPaymentOutbox')
      .where('deliveryStatus','in',['PENDING','PROCESSING'])
      .limit(Math.min(500,max*5)).get();
    const results:OutboxRecord[]=[];
    for(const doc of snapshot.docs){
      if(results.length>=max)break;
      const token=randomUUID();
      const candidate=await db.runTransaction(async tx=>{
        const latest=await tx.get(doc.ref);
        const state=latest.data() as OutboxRecord|undefined;
        if(!state||!['PENDING','PROCESSING'].includes(state.deliveryStatus)||
          state.nextAttemptAt>now||state.leaseUntil>now)return null;
        const next={...state,deliveryStatus:'PROCESSING' as const,leaseUntil:now+120_000,
          claimToken:token,updatedAt:new Date(now).toISOString()};
        tx.update(doc.ref,next);
        return next;
      });
      if(candidate)results.push(candidate);
    }
    return results;
  }
  async delivered(id:string,claimToken:string,now:number):Promise<void>{
    const ref=database().collection('orderPaymentOutbox').doc(id);
    await database().runTransaction(async tx=>{
      const doc=await tx.get(ref),value=doc.data() as OutboxRecord|undefined;
      if(!value||value.deliveryStatus!=='PROCESSING'||value.claimToken!==claimToken)return;
      tx.update(ref,{deliveryStatus:'DELIVERED',leaseUntil:0,claimToken:'',
        updatedAt:new Date(now).toISOString()});
    });
  }
  async retry(id:string,claimToken:string,now:number,errorCode:string,maxAttempts:number):Promise<void>{
    const ref=database().collection('orderPaymentOutbox').doc(id);
    await database().runTransaction(async tx=>{
      const doc=await tx.get(ref),value=doc.data() as OutboxRecord|undefined;
      if(!value||value.deliveryStatus!=='PROCESSING'||value.claimToken!==claimToken)return;
      const attempts=value.attemptCount+1;
      const dlq=attempts>=maxAttempts;
      const backoff=Math.min(3_600_000,30_000*2**Math.min(attempts,6));
      tx.update(ref,{
        deliveryStatus:dlq?'DLQ':'PENDING',attemptCount:attempts,
        nextAttemptAt:dlq?Number.MAX_SAFE_INTEGER:now+backoff,
        leaseUntil:0,claimToken:'',lastErrorCode:errorCode.slice(0,80),
        updatedAt:new Date(now).toISOString(),
      });
    });
  }
}
export class FirestoreOrderFinancialEventConsumer implements FinancialEventConsumer {
  async publish(event:OutboxRecord):Promise<void>{
    const ref=database().collection('commercialFinancialEvents').doc(event.id);
    const entry={
      id:event.id,tenantId:event.tenantId,unitId:event.unitId,
      orderId:event.orderId,paymentId:event.paymentId,
      paymentVersion:event.paymentVersion,kind:event.kind,status:event.status,
      grossAmountMinor:event.amountMinor,currency:'BRL' as const,
      method:event.method,provider:event.provider,occurredAt:event.occurredAt,
      collectedMinor:event.kind==='PAYMENT_CONFIRMED'?event.amountMinor:0,
      refundedMinor:event.kind==='PAYMENT_REFUNDED'?event.amountMinor:0,
      // An operator-recorded COD receipt is not evidence of bank settlement.
      settlementEvidenceKind:event.verificationSource??'NONE',
      ...(event.verifiedBy?{verifiedBy:event.verifiedBy}:{}),
      ...(event.receiptRef?{receiptRef:event.receiptRef}:{}),
    };
    try{await ref.create(entry);}
    catch(error){
      const existing=await ref.get();
      if(!existing.exists||JSON.stringify(existing.data())!==JSON.stringify(entry))throw error;
    }
  }
}
export interface OutboxReport {claimed:number;published:number;failed:number;}
export class OrderPaymentOutboxWorker {
  constructor(private readonly repo:OutboxRepository,
    private readonly sink:FinancialEventConsumer,
    private readonly clock:()=>number=Date.now){}
  async runOnce(limit=50):Promise<OutboxReport>{
    const now=this.clock();
    const jobs=await this.repo.claim(now,limit);
    const report={claimed:jobs.length,published:0,failed:0};
    for(const event of jobs){
      if(!event.claimToken)throw new Error('Outbox claim lacks fencing token');
      try{
        await this.sink.publish(event);
        await this.repo.delivered(event.id,event.claimToken,this.clock());
        report.published++;
      }catch{
        report.failed++;
        await this.repo.retry(event.id,event.claimToken,this.clock(),'DELIVERY_FAILED',8);
      }
    }
    return report;
  }
}
