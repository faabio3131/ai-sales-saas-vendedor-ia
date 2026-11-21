import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {ApplicationError} from '../infrastructure/errors';
import type {Order} from '../orders/model';
import type {OutboxRecord} from '../orderPayments/model';
import type {FinanceSources,FinanceSourceRepository,
  FinanceUnitSettings,FinanceSettingsRepository} from './model';

const db=()=>getFirestore(ensureFirebaseAdminApp());
const key=(t:string,u:string)=>createHash('sha256').update(JSON.stringify([t,u])).digest('hex');
function failed(code:string):never{
 throw new ApplicationError({category:'CONFLICT',code,
   message:'Financial data integrity cannot be established.'});
}
const MAX_SOURCES=5000;
export class FirestoreFinanceSourceRepository implements FinanceSourceRepository{
 async read(tenantId:string,unitId:string):Promise<FinanceSources>{
  const [orders,events]=await Promise.all([
   db().collection('orders').where('tenantId','==',tenantId)
     .where('unitId','==',unitId).limit(MAX_SOURCES+1).get(),
   db().collection('orderPaymentOutbox').where('tenantId','==',tenantId)
     .where('unitId','==',unitId).limit(MAX_SOURCES+1).get(),
  ]);
  // Never serve partial totals. Sharding/aggregation becomes mandatory at
  // scale rather than returning plausible but incorrect financial reports.
  if(orders.size>MAX_SOURCES||events.size>MAX_SOURCES)failed('FINANCE_SOURCE_LIMIT_EXCEEDED');
  const os=orders.docs.map(d=>d.data() as Order);
  const ev=events.docs.map(d=>d.data() as OutboxRecord);
  if(os.some(o=>o.tenantId!==tenantId||o.unitId!==unitId)||
    ev.some(e=>e.tenantId!==tenantId||e.unitId!==unitId))
    failed('FINANCE_SCOPE_VIOLATION');
  return {orders:os,events:ev};
 }
}
export class FirestoreFinanceSettingsRepository implements FinanceSettingsRepository {
 async get(t:string,u:string):Promise<FinanceUnitSettings|null>{
  const doc=await db().collection('financeUnitSettings').doc(key(t,u)).get();
  const entry=doc.data() as FinanceUnitSettings|undefined;
  return entry?.tenantId===t&&entry.unitId===u?entry:null;
 }
 async update(next:FinanceUnitSettings,expectedVersion:number):Promise<FinanceUnitSettings>{
  const ref=db().collection('financeUnitSettings').doc(key(next.tenantId,next.unitId));
  return db().runTransaction(async tx=>{
   const old=await tx.get(ref);
   const current=old.data() as FinanceUnitSettings|undefined;
   if((current&&(current.tenantId!==next.tenantId||current.unitId!==next.unitId))||
     (current?.version??0)!==expectedVersion||
     next.version!==expectedVersion+1)
     failed('FINANCE_SETTINGS_VERSION_CONFLICT');
   tx.set(ref,next);
   return next;
  });
 }
}
