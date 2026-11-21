import { createHash } from 'node:crypto';
import { getFirestore,type DocumentReference } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import type { Order } from '../orders/model';
import { denyPayment } from './policy';
import type {
 OrderPayment,OrderPaymentRepository,OrderPaymentStatus,OrderPaymentEventKind,OutboxRecord
} from './model';
const db=()=>getFirestore(ensureFirebaseAdminApp());
const hash=(...values:string[])=>createHash('sha256')
  .update(JSON.stringify(values)).digest('hex');
const paymentRef=(id:string)=>db().collection('orderPayments').doc(id);
const orderRef=(id:string)=>db().collection('orders').doc(id);
const byOrder=(t:string,u:string,o:string)=>db().collection('orderPaymentByOrder')
  .doc(hash(t,u,o));
const byIdem=(t:string,u:string,key:string)=>db().collection('orderPaymentByIdempotency')
  .doc(hash(t,u,key));
function projection(status:OrderPaymentStatus):Order['paymentState']{
  switch(status){
    case 'CREATION_RESERVED':case 'PENDING':case 'RECONCILIATION_REQUIRED':return 'PENDING';
    case 'CONFIRMED':return 'CONFIRMED';
    case 'REFUND_PENDING':return 'REFUND_PENDING';
    case 'REFUNDED':return 'REFUNDED';
    case 'EXPIRED':return 'EXPIRED';
    case 'FAILED':case 'CANCELLED':return 'FAILED';
  }
}
function eventOf(payment:OrderPayment,kind:OrderPaymentEventKind):OutboxRecord{
  return {
    id:hash(payment.id,String(payment.version)),tenantId:payment.tenantId,
    unitId:payment.unitId,orderId:payment.orderId,paymentId:payment.id,
    paymentVersion:payment.version,kind,status:payment.status,
    amountMinor:payment.amountMinor,method:payment.method,provider:payment.provider,
    occurredAt:payment.updatedAt,updatedAt:payment.updatedAt,
    ...(payment.verificationSource?{verificationSource:payment.verificationSource}:{}),
    ...(payment.verifiedBy?{verifiedBy:payment.verifiedBy}:{}),
    ...(payment.receiptRef?{receiptRef:payment.receiptRef}:{}),
    deliveryStatus:'PENDING',attemptCount:0,nextAttemptAt:0,leaseUntil:0,
  };
}
const statuses:Record<OrderPaymentStatus,OrderPaymentStatus[]>={
  CREATION_RESERVED:['PENDING','CONFIRMED','FAILED','EXPIRED','CANCELLED','RECONCILIATION_REQUIRED'],
  PENDING:['CONFIRMED','FAILED','EXPIRED','CANCELLED','RECONCILIATION_REQUIRED'],
  RECONCILIATION_REQUIRED:['PENDING','CONFIRMED','FAILED','EXPIRED','CANCELLED'],
  CONFIRMED:['REFUND_PENDING','REFUNDED'],
  REFUND_PENDING:['REFUNDED'],
  REFUNDED:[],
  FAILED:['CONFIRMED'],CANCELLED:['CONFIRMED'],EXPIRED:['CONFIRMED'],
};
function immutableCompatible(current:OrderPayment,next:OrderPayment):boolean{
  const fields=['id','tenantId','unitId','orderId','customerId','method','amountMinor',
    'currency','provider','idempotencyKey','fingerprint','createdAt','createdBy'] as const;
  return fields.every(field=>current[field]===next[field]);
}
export class FirestoreOrderPaymentRepository implements OrderPaymentRepository {
  async get(t:string,u:string,id:string):Promise<OrderPayment|null>{
    const doc=await paymentRef(id).get();
    const payment=doc.data() as OrderPayment|undefined;
    return payment?.tenantId===t&&payment.unitId===u?payment:null;
  }
  async byOrder(t:string,u:string,o:string):Promise<OrderPayment|null>{
    const ref=await byOrder(t,u,o).get();
    if(!ref.exists||ref.get('tenantId')!==t||ref.get('unitId')!==u)return null;
    return this.get(t,u,String(ref.get('paymentId')));
  }
  async byIdempotency(t:string,u:string,key:string):Promise<OrderPayment|null>{
    const ref=await byIdem(t,u,key).get();
    if(!ref.exists||ref.get('tenantId')!==t||ref.get('unitId')!==u)return null;
    return this.get(t,u,String(ref.get('paymentId')));
  }
  async byProvider(t:string,provider:string,providerPaymentId:string):Promise<OrderPayment|null>{
    const s=await db().collection('orderPayments')
      .where('tenantId','==',t).where('provider','==',provider)
      .where('providerPaymentId','==',providerPaymentId).limit(2).get();
    if(s.size!==1)return null;
    const item=s.docs[0].data() as OrderPayment;
    return item.tenantId===t&&item.provider===provider&&
      item.providerPaymentId===providerPaymentId?item:null;
  }
  async reserve(next:OrderPayment):Promise<{payment:OrderPayment;created:boolean}>{
    const pay=paymentRef(next.id),order=orderRef(next.orderId);
    const idem=byIdem(next.tenantId,next.unitId,next.idempotencyKey);
    const orderIndex=byOrder(next.tenantId,next.unitId,next.orderId);
    return db().runTransaction(async tx=>{
      const [i,oi,source]=await Promise.all([tx.get(idem),tx.get(orderIndex),tx.get(order)]);
      if(i.exists){
        if(i.get('tenantId')!==next.tenantId||i.get('unitId')!==next.unitId)
          denyPayment('ORDER_PAYMENT_IDEMPOTENCY_SCOPE','FORBIDDEN');
        const original=await tx.get(paymentRef(String(i.get('paymentId'))));
        const existing=original.data() as OrderPayment|undefined;
        if(!existing||existing.tenantId!==next.tenantId||
          existing.unitId!==next.unitId||existing.fingerprint!==next.fingerprint)
          denyPayment('ORDER_PAYMENT_IDEMPOTENCY_REUSED');
        return {payment:existing,created:false};
      }
      if(oi.exists)denyPayment('ORDER_PAYMENT_ALREADY_EXISTS');
      const base=source.data() as Order|undefined;
      if(!base||base.tenantId!==next.tenantId||base.unitId!==next.unitId||
        base.customerId!==next.customerId||base.id!==next.orderId)
        denyPayment('ORDER_PAYMENT_ORDER_NOT_FOUND','NOT_FOUND');
      if(base.status!=='CONFIRMED'||base.paymentState!=='NOT_REQUESTED'||
        base.totalMinor!==next.amountMinor||!base.customerConfirmation||
        base.customerConfirmation.totalMinor!==next.amountMinor)
        denyPayment('ORDER_PAYMENT_NOT_CONFIRMABLE');
      const updated:Order={...base,version:base.version+1,
        paymentState:projection(next.status),updatedAt:next.createdAt};
      tx.create(pay,next);
      tx.create(idem,{tenantId:next.tenantId,unitId:next.unitId,
        fingerprint:next.fingerprint,paymentId:next.id});
      tx.create(orderIndex,{tenantId:next.tenantId,unitId:next.unitId,
        paymentId:next.id,orderId:next.orderId});
      tx.set(order,updated);
      tx.create(db().collection('orderPaymentOutbox').doc(hash(next.id,String(next.version))),
        eventOf(next,'PAYMENT_INTENT_RESERVED'));
      return {payment:next,created:true};
    });
  }
  async transition(next:OrderPayment,expectedVersion:number,kind:OrderPaymentEventKind):Promise<OrderPayment>{
    const p=paymentRef(next.id),o=orderRef(next.orderId);
    return db().runTransaction(async tx=>{
      const [paymentSnap,orderSnap]=await Promise.all([tx.get(p),tx.get(o)]);
      const previous=paymentSnap.data() as OrderPayment|undefined;
      const order=orderSnap.data() as Order|undefined;
      if(!previous||!order||order.tenantId!==next.tenantId||
        order.unitId!==next.unitId||previous.version!==expectedVersion||
        next.version!==expectedVersion+1||!immutableCompatible(previous,next))
        denyPayment('ORDER_PAYMENT_VERSION_CONFLICT');
      if(!statuses[previous.status].includes(next.status))
        denyPayment('ORDER_PAYMENT_TRANSITION_INVALID');
      if(previous.providerPaymentId&&previous.providerPaymentId!==next.providerPaymentId)
        denyPayment('ORDER_PAYMENT_PROVIDER_REFERENCE_IMMUTABLE');
      // A charge identifier cannot be attached to two orders of one merchant.
      // This unique index is written in the SAME transaction as payment state.
      let providerIndex:DocumentReference|undefined;
      if(next.providerPaymentId&&!previous.providerPaymentId){
        const index=db().collection('orderPaymentProviderIds')
          .doc(hash(next.tenantId,next.provider,next.providerPaymentId));
        const existingIndex=await tx.get(index);
        if(existingIndex.exists&&existingIndex.get('paymentId')!==next.id)
          denyPayment('ORDER_PAYMENT_PROVIDER_ID_ALREADY_BOUND');
        if(!existingIndex.exists)providerIndex=index;
      }
      if(next.status==='CONFIRMED'&&
        (next.verificationSource!=='PSP_GET'&&next.verificationSource!=='OPERATOR_COD'))
        denyPayment('ORDER_PAYMENT_EVIDENCE_REQUIRED');
      if(next.status==='REFUNDED'&&(!previous.refund||next.verificationSource!=='PSP_GET'))
        denyPayment('ORDER_PAYMENT_REFUND_EVIDENCE_REQUIRED');
      if(next.status==='CONFIRMED'&&order.status==='CANCELLED')
        denyPayment('ORDER_PAYMENT_CANCELLED_ORDER','CONFLICT');
      if(providerIndex)tx.create(providerIndex,{
        tenantId:next.tenantId,provider:next.provider,
        providerPaymentId:next.providerPaymentId,paymentId:next.id,
      });
      tx.set(p,next);
      tx.update(o,{paymentState:projection(next.status),version:order.version+1,
        updatedAt:next.updatedAt});
      tx.create(db().collection('orderPaymentOutbox').doc(hash(next.id,String(next.version))),
        eventOf(next,kind));
      return next;
    });
  }
}
