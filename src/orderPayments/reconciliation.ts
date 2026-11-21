import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import type { OrderPayment } from './model';
import type { OrderPaymentService } from './service';
const database=()=>getFirestore(ensureFirebaseAdminApp());
const STATES=['PENDING','CREATION_RESERVED','RECONCILIATION_REQUIRED','REFUND_PENDING',
  'EXPIRED','FAILED','CANCELLED'] as const;
export interface OrderPaymentReconciliationRepository {
  candidates(limit:number):Promise<OrderPayment[]>;
  claim(id:string,now:number):Promise<boolean>;
  finish(id:string,now:number,success:boolean,reason:string):Promise<void>;
  investigation(payment:OrderPayment,reason:string):Promise<void>;
}
export class FirestoreOrderPaymentReconciliationRepository implements OrderPaymentReconciliationRepository {
  async candidates(limit:number):Promise<OrderPayment[]>{
    const entries:OrderPayment[]=[];
    const size=Math.max(1,Math.min(250,Math.floor(limit)));
    for(const state of STATES){
      const ref=database().collection('orderPaymentReconciliationCursors').doc(state);
      const saved=await ref.get(),after=saved.get('afterId') as string|undefined;
      const base=database().collection('orderPayments').where('status','==',state)
        .orderBy('__name__').limit(Math.ceil(size/STATES.length)+1);
      let docs=await (after?base.startAfter(after):base).get();
      if(docs.empty&&after)docs=await base.get();
      if(!docs.empty)await ref.set({afterId:docs.docs.at(-1)!.id,updatedAt:Date.now()},{merge:true});
      for(const doc of docs.docs){
        const p=doc.data() as OrderPayment;
        if(p.status===state&&p.provider!=='OFFLINE')entries.push(p);
        if(entries.length>=size)break;
      }
      if(entries.length>=size)break;
    }
    return entries;
  }
  async claim(id:string,now:number):Promise<boolean>{
    const ref=database().collection('orderPaymentReconciliationLeases').doc(id);
    return database().runTransaction(async tx=>{
      const old=await tx.get(ref);
      if((Number(old.get('leaseUntil'))||0)>now||(Number(old.get('nextDueAt'))||0)>now||
        old.get('dlq')===true)return false;
      tx.set(ref,{leaseUntil:now+120_000,lastAttemptAt:now},{merge:true});
      return true;
    });
  }
  async finish(id:string,now:number,success:boolean,reason:string):Promise<void>{
    const ref=database().collection('orderPaymentReconciliationLeases').doc(id);
    await database().runTransaction(async tx=>{
      const old=await tx.get(ref);
      const failures=success?0:Math.min(12,(Number(old.get('failures'))||0)+1);
      const dlq=!success&&failures>=8;
      const backoff=success?5*60_000:Math.min(60*60_000,30_000*2**Math.min(failures,7));
      tx.set(ref,{leaseUntil:0,nextDueAt:dlq?Number.MAX_SAFE_INTEGER:now+backoff,
        failures,dlq,lastOutcome:success?'VERIFIED':'RETRY',lastErrorCode:reason.slice(0,80),
        lastCompletedAt:now},{merge:true});
      if(dlq)tx.set(database().collection('orderPaymentReconciliationDlq').doc(id),{
        paymentId:id,reasonCode:reason.slice(0,80),failures,createdAt:new Date(now).toISOString()
      },{merge:true});
    });
  }
  async investigation(payment:OrderPayment,reason:string):Promise<void>{
    await database().collection('orderPaymentInvestigationCases').doc(payment.id).set({
      tenantId:payment.tenantId,unitId:payment.unitId,orderId:payment.orderId,
      paymentId:payment.id,provider:payment.provider,reasonCode:reason,
      requiresHumanReview:true,createdAt:payment.createdAt,
    },{merge:true});
  }
}
export interface OrderReconciliationSummary {
  scanned:number;claimed:number;refreshed:number;manualReview:number;failed:number;skipped:number;
}
export class OrderPaymentReconciliationWorker {
  constructor(private readonly repository:OrderPaymentReconciliationRepository,
    private readonly service:Pick<OrderPaymentService,'refreshVerified'>,
    private readonly clock:()=>number=Date.now){}
  async runOnce(limit=100):Promise<OrderReconciliationSummary>{
    const result={scanned:0,claimed:0,refreshed:0,manualReview:0,failed:0,skipped:0};
    const entries=await this.repository.candidates(limit);
    for(const entry of entries){
      result.scanned++;
      if(!await this.repository.claim(entry.id,this.clock())){result.skipped++;continue;}
      result.claimed++;
      if(!entry.providerPaymentId){
        await this.repository.investigation(entry,'PROVIDER_PAYMENT_REFERENCE_UNKNOWN');
        await this.repository.finish(entry.id,this.clock(),false,'MANUAL_RECONCILIATION_REQUIRED');
        result.manualReview++;continue;
      }
      if(entry.status==='REFUND_PENDING'&&entry.refund?.requestedAt&&
        this.clock()-Date.parse(entry.refund.requestedAt)>24*60*60*1000){
        await this.repository.investigation(entry,'REFUND_REQUIRES_MANUAL_REVIEW');
        await this.repository.finish(entry.id,this.clock(),false,'REFUND_PENDING_TOO_LONG');
        result.manualReview++;continue;
      }
      try{
        const checked=await this.service.refreshVerified(entry);
        if(checked.id!==entry.id||checked.tenantId!==entry.tenantId||
          checked.amountMinor!==entry.amountMinor||checked.provider!==entry.provider)
          throw new Error('PSP reconciliation mismatch');
        await this.repository.finish(entry.id,this.clock(),true,'VERIFIED_PSP_GET');
        result.refreshed++;
      }catch{
        await this.repository.finish(entry.id,this.clock(),false,'PSP_VERIFICATION_FAILED');
        result.failed++;
      }
    }
    return result;
  }
}
