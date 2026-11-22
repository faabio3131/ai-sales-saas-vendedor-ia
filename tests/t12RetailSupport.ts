import type {Scope,RetailRepository,RetailTransaction,RetailOrder,RetailCatalog,Receipt,Stock} from '../src/retail/model';
import type {CapabilityId} from '../src/capabilities/model';
import {RetailService} from '../src/retail/service';
import {actor,customerRepo,BASE,scope} from './t10ScheduleSupport';
const copy=<T>(x:T):T=>structuredClone(x);
export class MemoryRetail implements RetailRepository{
 catalogues=new Map<string,RetailCatalog>();orders=new Map<string,RetailOrder>();stocks=new Map<string,Stock>();receipts=new Map<string,Receipt>();movements:unknown[]=[];
 history:RetailOrder[]=[];grants=new Set<CapabilityId>(['RETAIL_CATALOG','RETAIL_CHECKOUT','RETAIL_INVENTORY']);
 activePlan=true;native=true;payments=true;private tail=Promise.resolve();
 async transact<T>(s:Scope,work:(tx:RetailTransaction)=>Promise<T>){
  const before=this.tail;let release!:()=>void;this.tail=new Promise(r=>{release=r;});await before;
  const k=JSON.stringify([s.tenantId,s.unitId])+':',orderRows=()=>[...this.orders.values()].filter(o=>o.tenantId===s.tenantId&&o.unitId===s.unitId);
  const staged:Array<()=>void>=[];
  const tx:RetailTransaction={
   grant:async(caps,_now,native,feature)=>this.activePlan&&(!native||this.native)&&caps.every(c=>this.grants.has(c))&&(!feature||this.payments),
   catalog:async()=>copy(this.catalogues.get(k)??null),stock:async i=>copy(this.stocks.get(k+i)??null),
   order:async i=>copy(this.orders.get(k+i)??null),receipt:async i=>copy(this.receipts.get(k+i)??null),
   active:async()=>orderRows().some(o=>o.status==='CONFIRMED'),
   orders:async(a,b)=>copy(orderRows().filter(o=>o.createdAt>=a&&o.createdAt<b)),
   saveCatalog:c=>staged.push(()=>this.catalogues.set(k,copy(c))),
   saveStock:s=>staged.push(()=>this.stocks.set(k+s.itemId,copy(s))),
   saveOrder:o=>staged.push(()=>{this.orders.set(k+o.id,copy(o));this.history.push(copy(o));}),
   saveReceipt:(i,r)=>staged.push(()=>this.receipts.set(k+i,copy(r))),
   saveMovement:(_id,r)=>staged.push(()=>this.movements.push(copy(r))),
  };
  try{const result=await work(tx);for(const commit of staged)commit();return copy(result);}finally{release();}
 }
}
export const products=[
 {id:'sku-a',sku:'A-01',name:'Camisa azul',category:'Vestuário',active:true,priceMinor:5000,trackStock:true},
 {id:'sku-b',sku:'B-02',name:'Boné',category:'Acessórios',active:true,priceMinor:2000,trackStock:false},
];
export function cartInput(t='tenant-a',k='cart1',qty=1){return {customerId:'customer-'+t,expectedCatalogVersion:1,lines:[{itemId:'sku-a',quantity:qty}],idempotencyKey:k};}
export const confirmInput=(v=1,total=5000,k='confirm1')=>({expectedVersion:v,idempotencyKey:k,acceptedTotalMinor:total,acceptanceRef:'Aceite registrado pelo atendente'});
export async function retailFixture(){
 const store=new MemoryRetail(),service=new RetailService(store,customerRepo,()=>new Date(BASE)),ctx=actor(),u='main';
 await service.publish(ctx,u,{expectedVersion:0,items:products});await service.adjust(ctx,u,'sku-a',{expectedVersion:0,onHand:2,reason:'Inventário inicial'});
 return {store,service,ctx,u,s:scope(),now:BASE};
}
