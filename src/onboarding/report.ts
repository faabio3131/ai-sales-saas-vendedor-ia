import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {TenantContext} from '../types/contracts';
import {requireBusinessAdmin,requireBusinessScope} from '../business/service';
import {resolveWindow} from '../finance/calendar';
import type {FinancePeriod} from '../finance/model';
import type {RetailOrder} from '../retail/model';
import type {Booking} from '../scheduling/model';
import type {Order} from '../orders/model';
import type {BusinessProfileRevision} from '../business/model';
import type {CapabilityAssignment} from '../capabilities/model';
import type {Subscription} from '../plans/model';
import {activePlan} from '../retail/plan';
import {object,reject} from '../scheduling/rules';
const key=(t:string,u:string)=>createHash('sha256').update(JSON.stringify([t,u])).digest('hex');
export function summarize(orders:Order[],retail:RetailOrder[],bookings:Booking[]){
 return {
  food:{orders:orders.length,confirmed:orders.filter(o=>o.status==='CONFIRMED').length,
   cancelled:orders.filter(o=>o.status==='CANCELLED').length,
   confirmedOrderValueMinor:orders.filter(o=>o.status==='CONFIRMED').reduce((a,o)=>a+o.totalMinor,0)},
  retail:{orders:retail.length,carts:retail.filter(o=>o.status==='CART').length,
   completed:retail.filter(o=>o.status==='COMPLETED').length,cancelled:retail.filter(o=>o.status==='CANCELLED').length,
   completedValueMinor:retail.filter(o=>o.status==='COMPLETED').reduce((a,o)=>a+o.totalMinor,0),
   verifiedCompletedMinor:retail.filter(o=>o.status==='COMPLETED'&&o.payment.state==='VERIFIED').reduce((a,o)=>a+o.totalMinor,0),
   manuallyRecordedCompletedMinor:retail.filter(o=>o.status==='COMPLETED'&&o.payment.state==='MANUAL_RECORDED').reduce((a,o)=>a+o.totalMinor,0),
   reviewRequired:retail.filter(o=>o.payment.state==='REVIEW_REQUIRED').length},
  services:{appointments:bookings.length,confirmed:bookings.filter(b=>b.status==='CONFIRMED').length,
   completed:bookings.filter(b=>b.status==='COMPLETED').length,noShows:bookings.filter(b=>b.status==='NO_SHOW').length,
   cancelled:bookings.filter(b=>b.status==='CANCELLED').length,
   completedPricedValueMinor:bookings.filter(b=>b.status==='COMPLETED'&&b.pack).reduce((a,b)=>a+b.pack!.priceMinor,0),
   completedWithoutPrice:bookings.filter(b=>b.status==='COMPLETED'&&!b.pack).length},
 };
}
export type MultiSectorMetrics=ReturnType<typeof summarize>;
export async function multisectorReport(ctx:TenantContext,u:string,raw:unknown){
 requireBusinessAdmin(ctx);const s=requireBusinessScope(ctx,u),a=object(raw,['period','anchor']);
 const period=a.period??'month';
 if(typeof period!=='string'||!['day','week','month'].includes(period)||a.anchor!==undefined&&typeof a.anchor!=='string')return reject('REPORT_PERIOD_INVALID');
 const db=getFirestore(ensureFirebaseAdminApp()),k=key(s.tenantId,s.unitId);
 return db.runTransaction(async tx=>{
  const now=new Date(),p=db.collection('businessProfiles').doc(k),assignment=db.collection('unitCapabilityAssignments').doc(k);
  const [pointer,ap,sub]=await Promise.all([tx.get(p),tx.get(assignment),tx.get(db.collection('subscriptions').doc(s.tenantId))]);
  const plan=activePlan(sub.data() as Subscription|undefined,s.tenantId,now.valueOf());
  if(!pointer.exists||pointer.get('tenantId')!==s.tenantId||pointer.get('unitId')!==s.unitId)return reject('REPORT_PROFILE_REQUIRED','CONFLICT');
  const profile=(await tx.get(p.collection('versions').where('effectiveFrom','<=',now.toISOString()).orderBy('effectiveFrom','desc').limit(1))).docs[0]?.data() as BusinessProfileRevision|undefined;
  if(!profile||profile.tenantId!==s.tenantId||profile.unitId!==s.unitId||profile.expiresAt&&profile.expiresAt<=now.toISOString())return reject('REPORT_PROFILE_REQUIRED','CONFLICT');
  const grant=ap.exists?(await tx.get(assignment.collection('versions').doc(String(ap.get('latestVersion'))))).data() as CapabilityAssignment|undefined:undefined;
  const valid=grant&&grant.tenantId===s.tenantId&&grant.unitId===s.unitId&&grant.vertical===profile.capabilityRegistry.vertical&&grant.operationMode===profile.capabilityRegistry.operationMode&&grant.state==='ENABLED_INTERNAL';
  const window=resolveWindow({period:period as FinancePeriod,anchor:a.anchor as string|undefined,timezone:profile.policy.timezone,weekStartsOn:1,now});
  const [food,retail,bookings]=await Promise.all([
   tx.get(db.collection('orders').where('tenantId','==',s.tenantId).where('unitId','==',s.unitId).where('createdAt','>=',window.startInclusive).where('createdAt','<',window.endExclusive).limit(1001)),
   tx.get(db.collection('retailUnits').doc(k).collection('orders').where('createdAt','>=',window.startInclusive).where('createdAt','<',window.endExclusive).limit(1001)),
   tx.get(db.collection('schedulingUnits').doc(k).collection('bookings').where('startMs','>=',Date.parse(window.startInclusive)).where('startMs','<',Date.parse(window.endExclusive)).limit(1001))
  ]);
  if([food,retail,bookings].some(x=>x.size>1000))return reject('REPORT_CAPACITY_SELECT_SHORTER_PERIOD','CONFLICT');
  const scoped=<T extends {tenantId:string;unitId:string}>(rows:T[])=>{
   if(rows.some(x=>x.tenantId!==s.tenantId||x.unitId!==s.unitId))return reject('REPORT_SCOPE_CORRUPT','INTERNAL');
   return rows;
  };
  return {...s,window,source:'CANONICAL_CURRENT_STATE_COHORT' as const,commercialGoLiveAuthorized:false as const,
   plan:plan?{code:plan.code,features:[...plan.features]}:null,
   capabilities:valid?grant!.enabledCapabilities:[],mode:profile.capabilityRegistry.operationMode,
   metrics:summarize(scoped(food.docs.map(d=>d.data() as Order)),scoped(retail.docs.map(d=>d.data() as RetailOrder)),scoped(bookings.docs.map(d=>d.data() as Booking))),
   coverage:'Orders created and appointments scheduled in the selected period; current states, not historical cash flow. No external PDV/agenda data included.'};
 });
}
