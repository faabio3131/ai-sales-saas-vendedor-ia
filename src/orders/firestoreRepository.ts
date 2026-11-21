import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { ApplicationError } from '../infrastructure/errors';
import type { Order,OrderRepository } from './model';

const db=()=>getFirestore(ensureFirebaseAdminApp());
const key=(...values:string[])=>createHash('sha256')
  .update(JSON.stringify(values)).digest('hex');
function conflict(code:string):never{
  throw new ApplicationError({category:'CONFLICT',code,
    message:'The order has been modified or an idempotency key was reused.'});
}
export class FirestoreOrderRepository implements OrderRepository {
  async listByScope(tenantId:string,unitId:string):Promise<Order[]>{
    const snapshot=await db().collection('orders').where('tenantId','==',tenantId)
      .where('unitId','==',unitId).get();
    return snapshot.docs.map(d=>d.data() as Order)
      .filter(o=>o.tenantId===tenantId&&o.unitId===unitId)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
  async findById(tenantId:string,unitId:string,orderId:string):Promise<Order|null>{
    const document=await db().collection('orders').doc(orderId).get();
    const order=document.data() as Order|undefined;
    return order?.tenantId===tenantId&&order.unitId===unitId?order:null;
  }
  async findByIdempotency(tenantId:string,unitId:string,idempotencyKey:string):
  Promise<{order:Order;fingerprint:string}|null>{
    const index=await db().collection('orderIdempotency')
      .doc(key(tenantId,unitId,idempotencyKey)).get();
    if(!index.exists)return null;
    if(index.get('tenantId')!==tenantId||index.get('unitId')!==unitId)conflict('ORDER_IDEMPOTENCY_SCOPE');
    const order=await this.findById(tenantId,unitId,String(index.get('orderId')));
    if(!order)conflict('ORDER_IDEMPOTENCY_CORRUPT');
    return {order,fingerprint:String(index.get('fingerprint'))};
  }
  async createAtomic(draft:Order,idempotencyKey:string,fingerprint:string):Promise<Order>{
    const orders=db().collection('orders');
    const orderRef=orders.doc(draft.id);
    const idemRef=db().collection('orderIdempotency')
      .doc(key(draft.tenantId,draft.unitId,idempotencyKey));
    const counterRef=db().collection('orderSequences').doc(key(draft.tenantId,draft.unitId));
    return db().runTransaction(async tx=>{
      const idem=await tx.get(idemRef);
      if(idem.exists){
        if(idem.get('tenantId')!==draft.tenantId||idem.get('unitId')!==draft.unitId||
          idem.get('fingerprint')!==fingerprint)conflict('ORDER_IDEMPOTENCY_CONFLICT');
        const order=await tx.get(orders.doc(String(idem.get('orderId'))));
        const original=order.data() as Order|undefined;
        if(!original||original.tenantId!==draft.tenantId||original.unitId!==draft.unitId)
          conflict('ORDER_IDEMPOTENCY_CORRUPT');
        return original;
      }
      const counter=await tx.get(counterRef);
      if(counter.exists&&(counter.get('tenantId')!==draft.tenantId||
        counter.get('unitId')!==draft.unitId))conflict('ORDER_SEQUENCE_SCOPE');
      const current=counter.exists?Number(counter.get('lastNumber')):0;
      if(!Number.isSafeInteger(current)||current<0||current>=Number.MAX_SAFE_INTEGER)
        conflict('ORDER_SEQUENCE_EXHAUSTED');
      const next=current+1;
      const created:Order={...draft,orderNumber:next,version:1};
      tx.create(orderRef,created);
      tx.create(idemRef,{tenantId:draft.tenantId,unitId:draft.unitId,
        idempotencyKey,fingerprint,orderId:draft.id});
      tx.set(counterRef,{tenantId:draft.tenantId,unitId:draft.unitId,lastNumber:next});
      return created;
    });
  }
  async updateAtomic(next:Order,expectedVersion:number):Promise<Order>{
    const ref=db().collection('orders').doc(next.id);
    return db().runTransaction(async tx=>{
      const prior=await tx.get(ref);
      const current=prior.data() as Order|undefined;
      if(!current||current.tenantId!==next.tenantId||current.unitId!==next.unitId)
        conflict('ORDER_NOT_CURRENT');
      if(current.version!==expectedVersion||next.version!==expectedVersion+1)
        conflict('ORDER_VERSION_CONFLICT');
      if(current.orderNumber!==next.orderNumber||current.customerId!==next.customerId||
        current.currency!==next.currency||current.operationMode!==next.operationMode||
        current.createdBy!==next.createdBy||current.createdAt!==next.createdAt)
        conflict('ORDER_IMMUTABLE_SCOPE');
      if(current.status==='CANCELLED'||(current.status==='CONFIRMED'&&next.status!=='CANCELLED')||
        (current.status==='DRAFT'&&!['DRAFT','CONFIRMED','CANCELLED'].includes(next.status)))
        conflict('ORDER_TRANSITION_INVALID');
      tx.set(ref,next);
      return next;
    });
  }
}
