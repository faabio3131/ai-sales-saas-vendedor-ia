import { ApplicationError } from '../infrastructure/errors';
import type { TenantContext } from '../types/contracts';
import type { BusinessProfileRepository } from '../business/contracts';
import { requireBusinessAdmin,requireBusinessScope } from '../business/service';
import type {
  UnitCatalogRepository,UnitCatalogInput,UnitCatalogRevision,UnitCatalogItem,
  CatalogChoice,PizzaOptions,DeliveryZone,CatalogPromotion
} from './model';

const ID=/^[a-zA-Z0-9_-]{1,80}$/;
const MAX_MINOR=100_000_000;
export function catalogError(code:string,category:'VALIDATION'|'CONFLICT'|'NOT_FOUND'|'FORBIDDEN'='VALIDATION'):never{
  throw new ApplicationError({category,code,message:'Catalog request cannot be completed.'});
}
export function catalogId(value:unknown):string{
  if(typeof value!=='string'||!ID.test(value)||['__proto__','constructor','prototype'].includes(value))catalogError('COMMERCE_ID_INVALID');
  return value as string;
}
export function catalogText(value:unknown,max=160):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||
    /[\u0000-\u001f]/.test(value))catalogError('COMMERCE_TEXT_INVALID');
  return (value as string).trim();
}
export function catalogMoney(value:unknown):number{
  if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>MAX_MINOR)
    catalogError('COMMERCE_PRICE_INVALID');
  return value as number;
}
function integer(value:unknown,min:number,max:number):number{
  if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)
    catalogError('COMMERCE_NUMBER_INVALID');
  return value as number;
}
export function catalogDate(value:unknown):string{
  if(typeof value!=='string'||! /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value))
    catalogError('COMMERCE_DATE_INVALID');
  const date=new Date(value as string);
  if(!Number.isFinite(date.valueOf()))catalogError('COMMERCE_DATE_INVALID');
  return date.toISOString();
}
export function limitedArray<T>(raw:unknown,max:number):T[]{
  if(!Array.isArray(raw)||raw.length>max)catalogError('COMMERCE_OPTIONS_INVALID');
  return raw as T[];
}
function uniqueIds<T extends {id:string}>(items:T[]):void{
  if(new Set(items.map(x=>x.id)).size!==items.length)catalogError('COMMERCE_DUPLICATE_ID');
}
function choices(raw:unknown):CatalogChoice[]{
  const options=limitedArray<CatalogChoice>(raw??[],30);
  const out=options.map(o=>{
    if(!o||typeof o.active!=='boolean')catalogError('COMMERCE_OPTIONS_INVALID');
    return {id:catalogId(o.id),name:catalogText(o.name),active:o.active,priceMinor:catalogMoney(o.priceMinor)};
  });
  uniqueIds(out);return out;
}
function sizedPrices(raw:unknown,sizes:string[]):Record<string,number>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))catalogError('COMMERCE_SIZE_PRICE_INVALID');
  const pairs=Object.entries(raw as Record<string,unknown>);
  if(!pairs.length||pairs.length>sizes.length)catalogError('COMMERCE_SIZE_PRICE_INVALID');
  const result:Record<string,number>={};
  for(const [key,v] of pairs){
    if(!sizes.includes(key))catalogError('COMMERCE_SIZE_PRICE_INVALID');
    result[key]=catalogMoney(v);
  }
  return result;
}
function pizza(raw:unknown):PizzaOptions{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))catalogError('COMMERCE_PIZZA_INVALID');
  const p=raw as PizzaOptions;
  const sizes=limitedArray<PizzaOptions['sizes'][number]>(p.sizes,12);
  if(!sizes.length)catalogError('COMMERCE_PIZZA_INVALID');
  const normalizedSizes=sizes.map(s=>{
    if(!s||typeof s.active!=='boolean')catalogError('COMMERCE_PIZZA_INVALID');
    return {id:catalogId(s.id),name:catalogText(s.name),active:s.active};
  });
  uniqueIds(normalizedSizes);
  const ids=normalizedSizes.map(s=>s.id);
  const flavors=limitedArray<PizzaOptions['flavors'][number]>(p.flavors,40);
  if(!flavors.length)catalogError('COMMERCE_PIZZA_INVALID');
  const normalizedFlavors=flavors.map(s=>{
    if(!s||typeof s.active!=='boolean')catalogError('COMMERCE_PIZZA_INVALID');
    return {id:catalogId(s.id),name:catalogText(s.name),active:s.active,
      pricesBySize:sizedPrices(s.pricesBySize,ids)};
  });
  uniqueIds(normalizedFlavors);
  function priced<T extends {id:string;name:string;active:boolean;pricesBySize:Record<string,number>}>(raw:unknown):T[]{
    const opts=limitedArray<T>(raw??[],30);
    const result=opts.map(o=>{
      if(!o||typeof o.active!=='boolean')catalogError('COMMERCE_PIZZA_INVALID');
      return {id:catalogId(o.id),name:catalogText(o.name),active:o.active,
        pricesBySize:sizedPrices(o.pricesBySize,ids)} as T;
    });
    uniqueIds(result);return result;
  }
  if(p.maxFlavors!==1&&p.maxFlavors!==2)catalogError('COMMERCE_PIZZA_INVALID');
  if(p.halfHalfPricing!=='MAX_FLAVOR'&&p.halfHalfPricing!=='AVERAGE_CEIL')catalogError('COMMERCE_PIZZA_INVALID');
  return {sizes:normalizedSizes,flavors:normalizedFlavors,
    borders:priced(p.borders),addons:priced(p.addons),
    maxFlavors:p.maxFlavors,halfHalfPricing:p.halfHalfPricing};
}
function items(raw:unknown):UnitCatalogItem[]{
  const list=limitedArray<UnitCatalogItem>(raw,100);
  const result:UnitCatalogItem[]=list.map(i=>{
    if(!i||typeof i.active!=='boolean'||!['ITEM','PIZZA','COMBO'].includes(i.kind))
      catalogError('COMMERCE_ITEM_INVALID');
    const common={id:catalogId(i.id),name:catalogText(i.name),active:i.active,kind:i.kind};
    if(i.kind==='PIZZA'){
      if(i.priceMinor!==undefined||i.variants?.length||i.components?.length)catalogError('COMMERCE_PIZZA_INVALID');
      return {...common,pizza:pizza(i.pizza),addons:[]};
    }
    if(i.pizza!==undefined)catalogError('COMMERCE_ITEM_INVALID');
    const priceMinor=catalogMoney(i.priceMinor);
    if(i.kind==='ITEM'){
      if(i.components?.length)catalogError('COMMERCE_ITEM_INVALID');
      return {...common,priceMinor,variants:choices(i.variants),addons:choices(i.addons)};
    }
    if(i.variants?.length||i.addons?.length)catalogError('COMMERCE_COMBO_INVALID');
    const components=limitedArray<{itemId:string;quantity:number}>(i.components,16);
    if(!components.length)catalogError('COMMERCE_COMBO_INVALID');
    return {...common,priceMinor,components:components.map(c=>({
      itemId:catalogId(c.itemId),quantity:integer(c.quantity,1,20)
    }))};
  });
  uniqueIds(result);
  const map=new Map(result.map(x=>[x.id,x]));
  for(const item of result){
    if(item.kind!=='COMBO')continue;
    for(const c of item.components??[]){
      const component=map.get(c.itemId);
      if(!component||component.kind!=='ITEM'||component.id===item.id)
        catalogError('COMMERCE_COMBO_COMPONENT_INVALID');
    }
  }
  return result;
}
function zones(raw:unknown):DeliveryZone[]{
  const out=limitedArray<DeliveryZone>(raw,50).map(z=>{
    if(!z||typeof z.active!=='boolean')catalogError('COMMERCE_DELIVERY_ZONE_INVALID');
    return {id:catalogId(z.id),name:catalogText(z.name),active:z.active,feeMinor:catalogMoney(z.feeMinor)};
  });
  uniqueIds(out);return out;
}
function promotions(raw:unknown,allowedIds:string[]):CatalogPromotion[]{
  const out=limitedArray<CatalogPromotion>(raw,30).map(p=>{
    if(!p||typeof p.active!=='boolean'||!['FIXED','PERCENT_BPS'].includes(p.kind))
      catalogError('COMMERCE_PROMOTION_INVALID');
    const code=catalogId(p.code).toUpperCase();
    const startsAt=catalogDate(p.startsAt),endsAt=catalogDate(p.endsAt);
    if(startsAt>=endsAt)catalogError('COMMERCE_PROMOTION_INVALID');
    const amount=p.kind==='FIXED'?catalogMoney(p.amount):integer(p.amount,1,10000);
    const eligibleItemIds=limitedArray<string>(p.eligibleItemIds,80).map(catalogId);
    if(new Set(eligibleItemIds).size!==eligibleItemIds.length||
      eligibleItemIds.some(x=>!allowedIds.includes(x)))catalogError('COMMERCE_PROMOTION_INVALID');
    return {code,active:p.active,kind:p.kind,startsAt,endsAt,amount,
      minSubtotalMinor:catalogMoney(p.minSubtotalMinor),eligibleItemIds};
  });
  if(new Set(out.map(x=>x.code)).size!==out.length)catalogError('COMMERCE_PROMOTION_DUPLICATE');
  return out;
}
export class UnitCatalogService {
  constructor(private readonly catalog:UnitCatalogRepository,
    private readonly businesses:BusinessProfileRepository,
    private readonly clock:()=>Date=()=>new Date()){}
  async latest(ctx:TenantContext,unitId:string):Promise<UnitCatalogRevision|null>{
    requireBusinessAdmin(ctx);
    const scope=requireBusinessScope(ctx,unitId);
    return this.catalog.latest(scope.tenantId,scope.unitId);
  }
  async effective(ctx:TenantContext,unitId:string,at=this.clock().toISOString()):Promise<UnitCatalogRevision|null>{
    const scope=requireBusinessScope(ctx,unitId);
    return this.catalog.effective(scope.tenantId,scope.unitId,catalogDate(at));
  }
  async publish(ctx:TenantContext,unitId:string,input:UnitCatalogInput):Promise<UnitCatalogRevision>{
    requireBusinessAdmin(ctx);
    const scope=requireBusinessScope(ctx,unitId);
    if(!input||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)
      catalogError('COMMERCE_VERSION_INVALID');
    const latest=await this.catalog.latest(scope.tenantId,scope.unitId);
    if((latest?.version??0)!==input.expectedVersion)
      catalogError('COMMERCE_VERSION_CONFLICT','CONFLICT');
    const from=catalogDate(input.effectiveFrom);
    const to=input.expiresAt==null?undefined:catalogDate(input.expiresAt);
    if((to&&to<=from)||(latest&&from<=latest.effectiveFrom))
      catalogError('COMMERCE_EFFECTIVE_PERIOD_INVALID');
    const now=this.clock().toISOString();
    const profile=await this.businesses.effective(scope.tenantId,scope.unitId,now);
    if(!profile||!profile.capabilityRegistry.capabilities.includes('ORDERING'))
      catalogError('COMMERCE_CAPABILITY_DISABLED','CONFLICT');
    const entries=items(input.items);
    if(entries.some(x=>x.kind==='PIZZA')&&!profile.capabilityRegistry.capabilities.includes('FOOD_SERVICE'))
      catalogError('COMMERCE_FOOD_CAPABILITY_REQUIRED','CONFLICT');
    const revision:UnitCatalogRevision={
      ...scope,version:input.expectedVersion+1,effectiveFrom:from,
      ...(to?{expiresAt:to}:{}),createdAt:now,createdBy:ctx.userId!,
      currency:'BRL',items:entries,deliveryZones:zones(input.deliveryZones),
      promotions:promotions(input.promotions,entries.map(x=>x.id)),
    };
    await this.catalog.createRevision(revision,input.expectedVersion);
    return revision;
  }
}
