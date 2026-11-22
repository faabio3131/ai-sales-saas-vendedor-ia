import {createHash,randomUUID} from 'node:crypto';
import type {TenantContext} from '../types/contracts';
import type {CustomerRepository} from '../customers/contracts';
import {requireBusinessScope,requireBusinessAdmin} from '../business/service';
import {object,id,integer,reason,reject,day,DAY} from '../scheduling/rules';
import type {CapabilityId} from '../capabilities/model';
import type {RetailRepository,RetailTransaction,RetailOrder,RetailItem,RetailCatalog,Stock} from './model';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uid=()=>randomUUID().replace(/-/g,'');
function printable(v:unknown,max:number){if(typeof v!=='string'||!v.trim()||v.trim().length>max||/[\u0000-\u001f]/.test(v))return reject('RETAIL_TEXT_INVALID');return v.trim();}
const CATALOG:CapabilityId[]=['RETAIL_CATALOG'],CHECKOUT:CapabilityId[]=['RETAIL_CATALOG','RETAIL_CHECKOUT'],INVENTORY:CapabilityId[]=['RETAIL_CATALOG','RETAIL_INVENTORY'];
export class RetailService{
 constructor(readonly store:RetailRepository,private readonly customers:Pick<CustomerRepository,'findById'>,private readonly clock:()=>Date=()=>new Date()){}
 now(){return this.clock().valueOf();}
 scope(ctx:TenantContext,u:string,write=false){
  if(!ctx.userId?.trim()||!(write?['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT','STAFF','CASHIER']:['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT','STAFF','CASHIER','VIEWER']).includes(ctx.role??''))
   return reject('RETAIL_ROLE_REQUIRED','FORBIDDEN');
  return requireBusinessScope(ctx,u);
 }
 async grant(tx:RetailTransaction,caps:CapabilityId[],native=true,feature?:'PAYMENTS'){
  if(!await tx.grant(caps,this.now(),native,feature))return reject('RETAIL_CAPABILITY_OR_PLAN_REQUIRED','FORBIDDEN');
 }
 async catalog(ctx:TenantContext,u:string){
  const s=this.scope(ctx,u);
  return this.store.transact(s,async tx=>{await this.grant(tx,CATALOG,false);return tx.catalog();});
 }
 async publish(ctx:TenantContext,u:string,raw:unknown){
  requireBusinessAdmin(ctx);const s=this.scope(ctx,u,true),a=object(raw,['expectedVersion','items']);
  const v=integer(a.expectedVersion,0,100000);
  if(!Array.isArray(a.items)||a.items.length>100)return reject('RETAIL_ITEMS_INVALID');
  const items:RetailItem[]=a.items.map(raw=>{
   const i=object(raw,['id','sku','name','category','active','priceMinor','trackStock']);
   if(typeof i.active!=='boolean'||typeof i.trackStock!=='boolean')return reject('RETAIL_ITEM_INVALID');
   return {id:id(i.id),sku:printable(i.sku,80),name:printable(i.name,120),category:printable(i.category,80),
    active:i.active,priceMinor:integer(i.priceMinor,0,100000000),trackStock:i.trackStock};
  });
  if(new Set(items.map(i=>i.id)).size!==items.length||new Set(items.map(i=>i.sku.toLowerCase())).size!==items.length)return reject('RETAIL_DUPLICATE_SKU');
  return this.store.transact(s,async tx=>{
   await this.grant(tx,CATALOG,false);
   if(items.some(i=>i.trackStock))await this.grant(tx,INVENTORY,false);
   const old=await tx.catalog();
   if((old?.version??0)!==v)return reject('RETAIL_CATALOG_VERSION_CONFLICT','CONFLICT');
   if(await tx.active())return reject('RETAIL_ACTIVE_ORDERS_BLOCK_CATALOG','CONFLICT');
   // Preserve identity and inventory semantics of an existing SKU.
   for(const i of old?.items??[]){
    const next=items.find(x=>x.id===i.id);
    if(!next||next.sku!==i.sku||next.trackStock!==i.trackStock)return reject('RETAIL_SKU_IMMUTABLE','CONFLICT');
   }
   const c:RetailCatalog={...s,version:v+1,items,updatedAt:new Date(this.now()).toISOString(),updatedBy:ctx.userId!};
   tx.saveCatalog(c);return c;
  });
 }
 async inventory(ctx:TenantContext,u:string){
  requireBusinessAdmin(ctx);const s=this.scope(ctx,u);
  return this.store.transact(s,async tx=>{
   await this.grant(tx,INVENTORY,false);const c=await tx.catalog();
   return Promise.all((c?.items??[]).filter(i=>i.trackStock).map(async i=>({item:i,stock:await this.getStock(tx,i.id)})));
  });
 }
 private async getStock(tx:RetailTransaction,itemId:string):Promise<Stock>{
  const x=await tx.stock(itemId)??{itemId,onHand:0,reserved:0,version:0};
  if(x.itemId!==itemId||![x.onHand,x.reserved,x.version].every(Number.isSafeInteger)||x.reserved<0||x.onHand<x.reserved)return reject('RETAIL_STOCK_CORRUPT','INTERNAL');
  return x;
 }
 async adjust(ctx:TenantContext,u:string,itemId:string,raw:unknown){
  requireBusinessAdmin(ctx);const s=this.scope(ctx,u,true),a=object(raw,['expectedVersion','onHand','reason']);
  const item=id(itemId),v=integer(a.expectedVersion,0,100000000),onHand=integer(a.onHand,0,100000000),why=reason(a.reason);
  return this.store.transact(s,async tx=>{
   await this.grant(tx,INVENTORY);const c=await tx.catalog(),before=await this.getStock(tx,item);
   if(!c?.items.some(i=>i.id===item&&i.trackStock))return reject('RETAIL_STOCK_ITEM_REQUIRED','NOT_FOUND');
   if(before.version!==v||onHand<before.reserved)return reject('RETAIL_STOCK_VERSION_OR_RESERVATION','CONFLICT');
   const after={...before,onHand,version:v+1};tx.saveStock(after);
   tx.saveMovement('adjust_'+item+'_'+after.version,{itemId:item,before,after,actorId:ctx.userId!,reason:why,at:new Date(this.now()).toISOString()});return after;
  });
 }
 private async row(tx:RetailTransaction,bid:string){const b=await tx.order(id(bid));if(!b)return reject('RETAIL_ORDER_NOT_FOUND','NOT_FOUND');return b;}
 private async replay(tx:RetailTransaction,key:string,hash:string){const r=await tx.receipt(key);if(!r)return null;if(r.fingerprint!==hash)return reject('RETAIL_IDEMPOTENCY_CONFLICT','CONFLICT');return this.row(tx,r.orderId);}
 private async priced(tx:RetailTransaction,v:number,raw:unknown){
  if(!Array.isArray(raw)||raw.length<1||raw.length>40)return reject('RETAIL_LINES_INVALID');
  const c=await tx.catalog();if(!c||c.version!==v)return reject('RETAIL_CATALOG_VERSION_CONFLICT','CONFLICT');
  const lines=raw.map(x=>{
   const a=object(x,['itemId','quantity']),item=c.items.find(i=>i.id===id(a.itemId)&&i.active);
   if(!item)return reject('RETAIL_ITEM_UNAVAILABLE','CONFLICT');
   const quantity=integer(a.quantity,1,1000);
   return {itemId:item.id,sku:item.sku,name:item.name,quantity,unitPriceMinor:item.priceMinor,totalMinor:item.priceMinor*quantity,trackStock:item.trackStock};
  });
  if(new Set(lines.map(l=>l.itemId)).size!==lines.length)return reject('RETAIL_DUPLICATE_LINE');
  const totalMinor=lines.reduce((a,l)=>a+l.totalMinor,0);
  if(!Number.isSafeInteger(totalMinor)||totalMinor>100000000)return reject('RETAIL_TOTAL_LIMIT');
  if(lines.some(l=>l.trackStock))await this.grant(tx,INVENTORY);
  return {lines,totalMinor};
 }
 async createCart(ctx:TenantContext,u:string,raw:unknown){
  const s=this.scope(ctx,u,true),a=object(raw,['customerId','expectedCatalogVersion','lines','idempotencyKey']);
  const customerId=id(a.customerId),v=integer(a.expectedCatalogVersion,1,100000),k=id(a.idempotencyKey);
  const hash=digest(['CART',customerId,v,a.lines]),bid='retail_'+uid();
  const customer=await this.customers.findById(s.tenantId,customerId);
  if(!customer||customer.id!==customerId||customer.tenantId!==s.tenantId||customer.status!=='ACTIVE')return reject('RETAIL_CUSTOMER_INVALID','FORBIDDEN');
  return this.store.transact(s,async tx=>{
   const prior=await this.replay(tx,k,hash);if(prior)return prior;
   await this.grant(tx,CHECKOUT);const price=await this.priced(tx,v,a.lines),now=new Date(this.now()).toISOString();
   const b:RetailOrder={...s,...price,id:bid,version:1,catalogVersion:v,customerId,status:'CART',currency:'BRL',payment:{state:'UNPAID'},createdAt:now,updatedAt:now,actorId:ctx.userId!};
   tx.saveOrder(b);tx.saveReceipt(k,{fingerprint:hash,orderId:bid});return b;
  });
 }
 private next(b:RetailOrder,ctx:TenantContext,patch:Partial<RetailOrder>):RetailOrder{return {...b,...patch,version:b.version+1,updatedAt:new Date(this.now()).toISOString(),actorId:ctx.userId!};}
 private async transition(ctx:TenantContext,u:string,bid:string,raw:unknown,op:string,keys:string[],
  work:(tx:RetailTransaction,b:RetailOrder,a:Record<string,unknown>)=>Promise<RetailOrder>){
  const s=this.scope(ctx,u,true),a=object(raw,['expectedVersion','idempotencyKey',...keys]),v=integer(a.expectedVersion,1,100000000),k=id(a.idempotencyKey);
  const hash=digest([op,id(bid),v,keys.map(key=>a[key])]);
  return this.store.transact(s,async tx=>{
   const r=await this.replay(tx,k,hash);if(r)return r;
   const b=await this.row(tx,bid);if(b.version!==v)return reject('RETAIL_ORDER_VERSION_CONFLICT','CONFLICT');
   const next=await work(tx,b,a);tx.saveOrder(next);tx.saveReceipt(k,{fingerprint:hash,orderId:b.id});return next;
  });
 }
 async editCart(ctx:TenantContext,u:string,bid:string,raw:unknown){
  return this.transition(ctx,u,bid,raw,'EDIT',['expectedCatalogVersion','lines'],async(tx,b,a)=>{
   await this.grant(tx,CHECKOUT);if(b.status!=='CART')return reject('RETAIL_CART_REQUIRED','CONFLICT');
   const v=integer(a.expectedCatalogVersion,1,100000),p=await this.priced(tx,v,a.lines);
   return this.next(b,ctx,{...p,catalogVersion:v});
  });
 }
 private async move(tx:RetailTransaction,b:RetailOrder,op:'RESERVE'|'RELEASE'|'CONSUME',ctx:TenantContext){
  const tracked=b.lines.filter(l=>l.trackStock),stocks=await Promise.all(tracked.map(l=>this.getStock(tx,l.itemId)));
  for(let i=0;i<tracked.length;i++){
   const l=tracked[i],before=stocks[i],qty=l.quantity;
   if(op==='RESERVE'&&before.onHand-before.reserved<qty)return reject('RETAIL_OUT_OF_STOCK','CONFLICT');
   if(op!=='RESERVE'&&before.reserved<qty)return reject('RETAIL_STOCK_CORRUPT','INTERNAL');
   const after:Stock={...before,reserved:before.reserved+(op==='RESERVE'?qty:-qty),onHand:before.onHand-(op==='CONSUME'?qty:0),version:before.version+1};
   tx.saveStock(after);tx.saveMovement(b.id+'_'+(b.version+1)+'_'+l.itemId,{itemId:l.itemId,before,after,actorId:ctx.userId!,reason:op,at:new Date(this.now()).toISOString()});
  }
 }
 async confirm(ctx:TenantContext,u:string,bid:string,raw:unknown){
  return this.transition(ctx,u,bid,raw,'CONFIRM',['acceptedTotalMinor','acceptanceRef'],async(tx,b,a)=>{
   await this.grant(tx,CHECKOUT);
   if(b.status!=='CART'||integer(a.acceptedTotalMinor,0,100000000)!==b.totalMinor)return reject('RETAIL_ACCEPTANCE_MISMATCH','CONFLICT');
   const ref=printable(a.acceptanceRef,160);
   const c=await tx.catalog();if(c?.version!==b.catalogVersion)return reject('RETAIL_CATALOG_VERSION_CONFLICT','CONFLICT');
   if(b.lines.some(l=>l.trackStock))await this.grant(tx,INVENTORY);
   await this.move(tx,b,'RESERVE',ctx);
   return this.next(b,ctx,{status:'CONFIRMED',acceptedTotalMinor:b.totalMinor,acceptanceRef:ref,confirmedAt:new Date(this.now()).toISOString()});
  });
 }
 async recordManual(ctx:TenantContext,u:string,bid:string,raw:unknown){
  if(!['OWNER','ADMIN','MANAGER','CASHIER'].includes(ctx.role??''))return reject('RETAIL_PAYMENT_ROLE_REQUIRED','FORBIDDEN');
  return this.transition(ctx,u,bid,raw,'MANUAL',['method','amountMinor','evidenceRef'],async(_tx,b,a)=>{
   if(b.status!=='CONFIRMED'||b.payment.state!=='UNPAID'||integer(a.amountMinor,0,100000000)!==b.totalMinor||
    !['CASH','CARD','PIX_MANUAL'].includes(String(a.method)))return reject('RETAIL_MANUAL_PAYMENT_INVALID','CONFLICT');
   return this.next(b,ctx,{payment:{state:'MANUAL_RECORDED',method:a.method as 'CASH'|'CARD'|'PIX_MANUAL',evidenceRef:printable(a.evidenceRef,160),recordedBy:ctx.userId!}});
  });
 }
 async complete(ctx:TenantContext,u:string,bid:string,raw:unknown){
  return this.transition(ctx,u,bid,raw,'COMPLETE',[],async(tx,b)=>{
   if(b.status!=='CONFIRMED'||b.totalMinor>0&&!['VERIFIED','MANUAL_RECORDED'].includes(b.payment.state))return reject('RETAIL_SETTLEMENT_REQUIRED','CONFLICT');
   await this.move(tx,b,'CONSUME',ctx);return this.next(b,ctx,{status:'COMPLETED',completedAt:new Date(this.now()).toISOString()});
  });
 }
 async cancel(ctx:TenantContext,u:string,bid:string,raw:unknown){
  return this.transition(ctx,u,bid,raw,'CANCEL',['reason'],async(tx,b,a)=>{
   if(b.status!=='CART'&&b.status!=='CONFIRMED')return reject('RETAIL_CANCEL_INVALID','CONFLICT');
   if(b.payment.state==='CREATING')return reject('RETAIL_PAYMENT_IN_FLIGHT','CONFLICT');
   if(b.status==='CONFIRMED')await this.move(tx,b,'RELEASE',ctx);
   const payment=b.payment.state==='UNPAID'||b.payment.state==='REFUNDED'?b.payment:{...b.payment,state:'REVIEW_REQUIRED' as const};
   return this.next(b,ctx,{status:'CANCELLED',cancelReason:reason(a.reason),payment});
  });
 }
 async get(ctx:TenantContext,u:string,bid:string){const s=this.scope(ctx,u,true);return this.store.transact(s,tx=>this.row(tx,bid));}
 async list(ctx:TenantContext,u:string,raw:unknown){
  const s=this.scope(ctx,u,true),a=object(raw,['from','to']),start=day(a.from),end=day(a.to);
  if(end<=start||Date.parse(end)-Date.parse(start)>31*DAY)return reject('RETAIL_RANGE_INVALID');
  return this.store.transact(s,tx=>tx.orders(start+'T00:00:00.000Z',end+'T00:00:00.000Z'));
 }
}
