import {createHash} from 'node:crypto';
import {getFirestore,FieldPath,type QueryDocumentSnapshot} from 'firebase-admin/firestore';
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
// A bounded, paginated scan prevents the original 5,000-document truncation
// from silently breaking a busy restaurant after a few weeks. At 100k the
// service fails closed and requires a materialized projection, not fake totals.
const MAX_SOURCES=100_000;
const PAGE_SIZE=500;
async function collect<T extends {tenantId:string;unitId:string}>(
 collection:string,tenantId:string,unitId:string):Promise<T[]>{
 const records:T[]=[];
 const base=db().collection(collection).where('tenantId','==',tenantId)
   .where('unitId','==',unitId).orderBy(FieldPath.documentId());
 let cursor:QueryDocumentSnapshot|undefined;
 do{
  const page=await (cursor?base.startAfter(cursor):base).limit(PAGE_SIZE).get();
  if(page.empty)break;
  if(records.length+page.size>MAX_SOURCES)failed('FINANCE_SOURCE_LIMIT_EXCEEDED');
  for(const d of page.docs){
   const record=d.data() as T;
   if(record.tenantId!==tenantId||record.unitId!==unitId)
     failed('FINANCE_SCOPE_VIOLATION');
   records.push(record);
  }
  cursor=page.docs.at(-1);
  if(page.size<PAGE_SIZE)break;
 }while(cursor);
 return records;
}
export class FirestoreFinanceSourceRepository implements FinanceSourceRepository{
 async read(tenantId:string,unitId:string):Promise<FinanceSources>{
  const [orders,events]=await Promise.all([
   collect<Order>('orders',tenantId,unitId),
   collect<OutboxRecord>('orderPaymentOutbox',tenantId,unitId),
  ]);
  return {orders,events};
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
