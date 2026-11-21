import { ApplicationError } from '../infrastructure/errors';
import type { Order } from '../orders/model';
import type { CommercialMetrics,FinanceSnapshot,FinanceSources,FinancialWindow,ProductRank } from './model';

function corrupt(code:string):never{
  throw new ApplicationError({category:'CONFLICT',code,
    message:'The financial records require reconciliation before this report can be trusted.'});
}
function sum(amount:number,value:number):number{
  if(!Number.isSafeInteger(value)||value<0||!Number.isSafeInteger(amount+value))
    corrupt('FINANCE_AMOUNT_INVALID');
  return amount+value;
}
function validInstant(iso:string):boolean{
  return typeof iso==='string'&&Number.isFinite(Date.parse(iso))&&
    new Date(iso).toISOString()===iso;
}
const receipt='PAYMENT_CONFIRMED',refunded='PAYMENT_REFUNDED';
const expected:Record<string,string>={
  PAYMENT_INTENT_RESERVED:'CREATION_RESERVED',
  PAYMENT_AWAITING_VERIFICATION:'PENDING',
  PAYMENT_CONFIRMED:'CONFIRMED',PAYMENT_FAILED:'FAILED',
  PAYMENT_EXPIRED:'EXPIRED',PAYMENT_CANCELLED:'CANCELLED',
  PAYMENT_RECONCILIATION_REQUIRED:'RECONCILIATION_REQUIRED',
  PAYMENT_REFUND_REQUESTED:'REFUND_PENDING',PAYMENT_REFUNDED:'REFUNDED',
};
function within(iso:string,start:string,end:string):boolean{
  return iso>=start&&iso<end;
}
export function computeCommercialSnapshot(input:{
 tenantId:string;unitId:string;window:FinancialWindow;sources:FinanceSources;
}):FinanceSnapshot{
 const {tenantId,unitId,window,sources}=input;
 const orders=new Map<string,Order>();
 const paymentToOrder=new Map<string,string>();
 const orderToPayment=new Map<string,string>();
 const versions=new Map<string,Set<number>>();
 const createdIds=new Set<string>();
 let verifiedEvents=0;
 for(const order of sources.orders){
  if(order.tenantId!==tenantId||order.unitId!==unitId||!order.id||
    orders.has(order.id)||order.currency!=='BRL')
    corrupt('FINANCE_ORDER_SCOPE_OR_DUPLICATE');
  if(!Number.isSafeInteger(order.totalMinor)||order.totalMinor<0||
    !Number.isSafeInteger(order.subtotalMinor)||order.subtotalMinor<0||
    !Number.isSafeInteger(order.deliveryFeeMinor)||order.deliveryFeeMinor<0||
    !Number.isSafeInteger(order.discountMinor)||order.discountMinor<0||
    order.subtotalMinor+order.deliveryFeeMinor-order.discountMinor!==order.totalMinor)
    corrupt('FINANCE_ORDER_TOTAL_MISMATCH');
  if(order.customerConfirmation&&(
    !validInstant(order.customerConfirmation.at)||
    order.customerConfirmation.totalMinor!==order.totalMinor))
    corrupt('FINANCE_CONFIRMATION_MISMATCH');
  orders.set(order.id,order);
 }
 const events=[...sources.events].sort((a,b)=>
   a.paymentId.localeCompare(b.paymentId)||a.paymentVersion-b.paymentVersion);
 for(const e of events){
  if(e.tenantId!==tenantId||e.unitId!==unitId||!e.id||createdIds.has(e.id)||
    !validInstant(e.occurredAt)||!Number.isSafeInteger(e.paymentVersion)||
    e.paymentVersion<1||e.amountMinor<=0||!Number.isSafeInteger(e.amountMinor)||
    expected[e.kind]!==e.status)
    corrupt('FINANCE_EVENT_INTEGRITY_FAILED');
  createdIds.add(e.id);
  const original=orders.get(e.orderId);
  if(!original||!original.customerConfirmation||
    original.customerId===undefined||original.totalMinor!==e.amountMinor)
    corrupt('FINANCE_EVENT_ORDER_MISMATCH');
  if(paymentToOrder.has(e.paymentId)&&paymentToOrder.get(e.paymentId)!==e.orderId)
    corrupt('FINANCE_PAYMENT_MULTIPLE_ORDERS');
  if(orderToPayment.has(e.orderId)&&orderToPayment.get(e.orderId)!==e.paymentId)
    corrupt('FINANCE_ORDER_MULTIPLE_PAYMENTS');
  paymentToOrder.set(e.paymentId,e.orderId);
  orderToPayment.set(e.orderId,e.paymentId);
  const list=versions.get(e.paymentId)??new Set<number>();
  if(list.has(e.paymentVersion))corrupt('FINANCE_PAYMENT_VERSION_DUPLICATE');
  list.add(e.paymentVersion);versions.set(e.paymentId,list);
 }
 for(const paymentId of versions.keys()){
  const sorted=events.filter(e=>e.paymentId===paymentId);
  if(sorted[0]?.paymentVersion!==1||sorted[0].kind!=='PAYMENT_INTENT_RESERVED'||
    sorted.some((e,i)=>e.paymentVersion!==i+1))
    corrupt('FINANCE_PAYMENT_VERSION_GAP');
  if(sorted.some((e,i)=>i>0&&e.occurredAt<sorted[i-1].occurredAt))
    corrupt('FINANCE_EVENT_TIME_REGRESSION');
 }
 const cutoff=window.endExclusive<window.asOf?window.endExclusive:window.asOf;
 const counts=new Map<string,{confirmed:boolean;refunded:boolean;lastKind?:string}>();
 const metrics:CommercialMetrics={
  currency:'BRL',orderCount:0,grossSalesMinor:0,discountsMinor:0,
  netSalesMinor:0,confirmedReceiptsMinor:0,refundsMinor:0,
  netReceiptsMinor:0,pendingReceivablesMinor:0,averageTicketMinor:0,
  processingFeesMinor:null,netAfterProcessingFeesMinor:null,
  feeCoverage:'NOT_REPORTED_BY_VERIFIED_PSP_FEED',
  platformAICostsIncluded:false,ranking:[],
 };
 for(const e of events.filter(e=>e.occurredAt<cutoff).sort((a,b)=>
  a.occurredAt.localeCompare(b.occurredAt)||a.paymentVersion-b.paymentVersion)){
  const state=counts.get(e.orderId)??{confirmed:false,refunded:false};
  if(e.kind===receipt){
    const offline=e.provider==='OFFLINE'&&
      ['CASH_ON_DELIVERY','CARD_ON_DELIVERY'].includes(e.method);
    const evidenceOK=offline?e.verificationSource==='OPERATOR_COD':
      e.provider!=='OFFLINE'&&e.verificationSource==='PSP_GET';
    if(state.confirmed||!evidenceOK)
      corrupt('FINANCE_UNVERIFIED_OR_DUPLICATE_RECEIPT');
    state.confirmed=true;verifiedEvents++;
    if(within(e.occurredAt,window.startInclusive,window.endExclusive))
      metrics.confirmedReceiptsMinor=sum(metrics.confirmedReceiptsMinor,e.amountMinor);
  }else if(e.kind===refunded){
    if(!state.confirmed||state.refunded||e.verificationSource!=='PSP_GET')
      corrupt('FINANCE_UNVERIFIED_REFUND');
    state.refunded=true;verifiedEvents++;
    if(within(e.occurredAt,window.startInclusive,window.endExclusive))
      metrics.refundsMinor=sum(metrics.refundsMinor,e.amountMinor);
  }
  state.lastKind=e.kind;counts.set(e.orderId,state);
 }
 const ranks=new Map<string,ProductRank>();
 for(const order of orders.values()){
  const accepted=order.status==='CONFIRMED'&&Boolean(order.customerConfirmation);
  if(!accepted)continue;
  if(!within(order.customerConfirmation!.at,window.startInclusive,cutoff))continue;
  const gross=sum(order.subtotalMinor,order.deliveryFeeMinor);
  metrics.grossSalesMinor=sum(metrics.grossSalesMinor,gross);
  metrics.discountsMinor=sum(metrics.discountsMinor,order.discountMinor);
  metrics.netSalesMinor=sum(metrics.netSalesMinor,order.totalMinor);
  metrics.orderCount++;
  const state=counts.get(order.id);
  if(order.paymentState!=='NOT_REQUESTED'&&!orderToPayment.has(order.id))
    corrupt('FINANCE_PAYMENT_OUTBOX_MISSING');
  if(!state?.confirmed)
    metrics.pendingReceivablesMinor=sum(metrics.pendingReceivablesMinor,order.totalMinor);
  for(const item of order.lines){
    if(!item.catalogItemId||!item.name||
      !Number.isSafeInteger(item.quantity)||item.quantity<1||
      !Number.isSafeInteger(item.totalMinor)||item.totalMinor<0)
      corrupt('FINANCE_LINE_INVALID');
    const existing=ranks.get(item.catalogItemId);
    if(existing&&existing.name!==item.name) {
      // Versioned catalog may change its label. Group by catalog ID,
      // preserve snapshot label from the earliest accepted order.
    }
    ranks.set(item.catalogItemId,{
      catalogItemId:item.catalogItemId,
      name:existing?.name??item.name,
      quantity:sum(existing?.quantity??0,item.quantity),
      grossItemSalesMinor:sum(existing?.grossItemSalesMinor??0,item.totalMinor),
    });
  }
 }
 metrics.netReceiptsMinor=metrics.confirmedReceiptsMinor-metrics.refundsMinor;
 if(!Number.isSafeInteger(metrics.netReceiptsMinor))corrupt('FINANCE_NET_RECEIPTS_OVERFLOW');
 metrics.averageTicketMinor=metrics.orderCount>0?
   Math.round(metrics.netSalesMinor/metrics.orderCount):0;
 metrics.ranking=[...ranks.values()].sort((a,b)=>
   b.quantity-a.quantity||b.grossItemSalesMinor-a.grossItemSalesMinor||
   a.catalogItemId.localeCompare(b.catalogItemId)).slice(0,20);
 return {
  tenantId,unitId,generatedAt:window.asOf,window,metrics,
  source:'CANONICAL_ORDERS_AND_TRANSACTIONAL_PAYMENT_OUTBOX',
  coverage:'T03_T04_ORDER_PAYMENTS_ONLY',
  reconciliation:{orders:orders.size,events:events.length,
    distinctPayments:versions.size,verifiedEvents,errors:0},
 };
}
