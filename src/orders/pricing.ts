import type { UnitCatalogRevision,UnitCatalogItem,PizzaFlavor,
  PizzaBorder,PizzaAddon,CatalogChoice } from '../commerce/model';
import { catalogError, catalogId,catalogText } from '../commerce/service';
import type { LineSnapshot,OrderLineSelection,OrderFulfillmentInput } from './model';

const MAX_TOTAL=1_000_000_000;
function money(n:unknown):number{
  if(!Number.isSafeInteger(n)||Number(n)<0||Number(n)>MAX_TOTAL)
    catalogError('ORDER_AMOUNT_OUT_OF_RANGE');
  return n as number;
}
function sum(a:number,b:number):number{return money(a+b);}
function mul(a:number,b:number):number{return money(a*b);}
function permittedKeys(value:object,keys:string[]):void{
  if(Object.keys(value).some(k=>!keys.includes(k)))catalogError('ORDER_FIELDS_INVALID');
}
function selected<T extends {id:string;active:boolean}>(
  array:T[]|undefined,id:string,code='ORDER_OPTION_UNAVAILABLE'):T {
  const found=array?.find(x=>x.id===id);
  if(!found||!found.active)catalogError(code,'CONFLICT');
  return found;
}
function addonsFromChoices(ids:string[],options:CatalogChoice[]):{
  addons:Array<{id:string;name:string;priceMinor:number}>;total:number
}{
  const addons=ids.map(id=>{
    const a=selected(options,id);
    return {id:a.id,name:a.name,priceMinor:money(a.priceMinor)};
  });
  return {addons,total:addons.reduce((s,a)=>sum(s,a.priceMinor),0)};
}
function pizzaPrice(item:UnitCatalogItem,input:OrderLineSelection):
  Pick<LineSnapshot,'size'|'flavors'|'halfHalfPricing'|'border'|'addons'|'unitPriceMinor'> {
  const p=item.pizza;
  if(!p)catalogError('ORDER_PIZZA_UNCONFIGURED','CONFLICT');
  if(input.variantId!==undefined)catalogError('ORDER_PIZZA_VARIANT_INVALID');
  const size=selected(p.sizes,catalogId(input.sizeId),'ORDER_SIZE_UNAVAILABLE');
  if(!Array.isArray(input.flavorIds)||input.flavorIds.length<1||
    input.flavorIds.length>p.maxFlavors)catalogError('ORDER_FLAVORS_INVALID');
  const flavors=input.flavorIds.map(id=>selected<PizzaFlavor>(p.flavors,catalogId(id),'ORDER_FLAVOR_UNAVAILABLE'));
  if(new Set(flavors.map(f=>f.id)).size!==flavors.length)catalogError('ORDER_FLAVORS_DUPLICATED');
  const mapped=flavors.map(f=>{
    const value=f.pricesBySize[size.id];
    if(value===undefined)catalogError('ORDER_FLAVOR_SIZE_UNAVAILABLE','CONFLICT');
    return {id:f.id,name:f.name,priceMinor:money(value)};
  });
  const price=mapped.length===1?mapped[0].priceMinor:
    p.halfHalfPricing==='MAX_FLAVOR'?
      Math.max(mapped[0].priceMinor,mapped[1].priceMinor):
      Math.floor((mapped[0].priceMinor+mapped[1].priceMinor+1)/2);
  let border:LineSnapshot['border'];
  if(input.borderId!==undefined) {
    const b=selected<PizzaBorder>(p.borders,catalogId(input.borderId),'ORDER_BORDER_UNAVAILABLE');
    const amount=b.pricesBySize[size.id];
    if(amount===undefined)catalogError('ORDER_BORDER_SIZE_UNAVAILABLE','CONFLICT');
    border={id:b.id,name:b.name,priceMinor:money(amount)};
  }
  const addonIds=input.addonIds??[];
  if(!Array.isArray(addonIds)||addonIds.length>12||
    new Set(addonIds).size!==addonIds.length)catalogError('ORDER_ADDONS_INVALID');
  const addons=addonIds.map(id=>{
    const a=selected<PizzaAddon>(p.addons,catalogId(id),'ORDER_ADDON_UNAVAILABLE');
    const amount=a.pricesBySize[size.id];
    if(amount===undefined)catalogError('ORDER_ADDON_SIZE_UNAVAILABLE','CONFLICT');
    return {id:a.id,name:a.name,priceMinor:money(amount)};
  });
  const addPrice=addons.reduce((s,a)=>sum(s,a.priceMinor),0);
  const unitPriceMinor=sum(sum(price,border?.priceMinor??0),addPrice);
  return {size:{id:size.id,name:size.name},flavors:mapped,
    ...(mapped.length===2?{halfHalfPricing:p.halfHalfPricing}:{}),
    ...(border?{border}:{}),addons,unitPriceMinor};
}
function selectedItem(catalog:UnitCatalogRevision,id:string):UnitCatalogItem {
  const item=catalog.items.find(i=>i.id===id);
  if(!item||!item.active)catalogError('ORDER_ITEM_UNAVAILABLE','CONFLICT');
  return item;
}
function pricedLine(catalog:UnitCatalogRevision,input:OrderLineSelection):LineSnapshot {
  if(!input||typeof input!=='object'||Array.isArray(input))
    catalogError('ORDER_LINE_INVALID');
  permittedKeys(input,['catalogItemId','quantity','variantId','sizeId','flavorIds','borderId','addonIds']);
  const item=selectedItem(catalog,catalogId(input.catalogItemId));
  const quantity=input.quantity;
  if(!Number.isSafeInteger(quantity)||quantity<1||quantity>50)
    catalogError('ORDER_QUANTITY_INVALID');
  const base={catalogItemId:item.id,kind:item.kind,name:item.name,quantity};
  if(item.kind==='PIZZA'){
    const snapshot=pizzaPrice(item,input);
    return {...base,...snapshot,totalMinor:mul(snapshot.unitPriceMinor,quantity)};
  }
  if(input.sizeId!==undefined||input.flavorIds!==undefined||input.borderId!==undefined)
    catalogError('ORDER_OPTION_NOT_APPLICABLE');
  if(item.kind==='COMBO'){
    if(input.variantId!==undefined||input.addonIds!==undefined)
      catalogError('ORDER_OPTION_NOT_APPLICABLE');
    const components=(item.components??[]).map(c=>{
      const component=selectedItem(catalog,c.itemId);
      if(component.kind!=='ITEM')catalogError('ORDER_COMBO_UNAVAILABLE','CONFLICT');
      return {itemId:c.itemId,name:component.name,quantity:c.quantity};
    });
    const unitPriceMinor=money(item.priceMinor);
    return {...base,comboComponents:components,unitPriceMinor,
      totalMinor:mul(unitPriceMinor,quantity)};
  }
  let unitPriceMinor=money(item.priceMinor);
  let variant:LineSnapshot['variant'];
  if(input.variantId!==undefined){
    const v=selected(item.variants,catalogId(input.variantId),'ORDER_VARIANT_UNAVAILABLE');
    variant={id:v.id,name:v.name};
    unitPriceMinor=money(v.priceMinor);
  }
  const addonIds=input.addonIds??[];
  if(!Array.isArray(addonIds)||addonIds.length>12||
    new Set(addonIds).size!==addonIds.length)catalogError('ORDER_ADDONS_INVALID');
  const addons=addonsFromChoices(addonIds.map(catalogId),item.addons??[]);
  unitPriceMinor=sum(unitPriceMinor,addons.total);
  return {...base,...(variant?{variant}:{}),addons:addons.addons,unitPriceMinor,
    totalMinor:mul(unitPriceMinor,quantity)};
}
export interface PricedOrder {
  lines:LineSnapshot[];
  fulfillment:OrderFulfillmentInput;
  subtotalMinor:number;discountMinor:number;deliveryFeeMinor:number;totalMinor:number;
  appliedPromotion?:{code:string;discountMinor:number};
}
export function priceOrder(catalog:UnitCatalogRevision,
  input:{lines:OrderLineSelection[];fulfillment:OrderFulfillmentInput;promotionCode?:string},
  at:string):PricedOrder {
  if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>40)
    catalogError('ORDER_LINES_INVALID');
  const lines=input.lines.map(line=>pricedLine(catalog,line));
  const subtotalMinor=lines.reduce((s,l)=>sum(s,l.totalMinor),0);
  let deliveryFeeMinor=0;
  const f=input.fulfillment;
  if(!f||typeof f!=='object'||Array.isArray(f))catalogError('ORDER_FULFILLMENT_INVALID');
  let fulfillment:OrderFulfillmentInput;
  if(f.kind==='PICKUP'){
    permittedKeys(f,['kind']);
    fulfillment={kind:'PICKUP'};
  } else if(f.kind==='DELIVERY'){
    permittedKeys(f,['kind','zoneId','address']);
    const zone=selected(catalog.deliveryZones,catalogId(f.zoneId),'ORDER_DELIVERY_ZONE_UNAVAILABLE');
    deliveryFeeMinor=money(zone.feeMinor);
    const address=catalogText(f.address,300);
    if(address.length<8)catalogError('ORDER_DELIVERY_ADDRESS_INVALID');
    fulfillment={kind:'DELIVERY',zoneId:zone.id,address};
  } else catalogError('ORDER_FULFILLMENT_INVALID');
  let discountMinor=0,appliedPromotion:PricedOrder['appliedPromotion'];
  if(input.promotionCode!==undefined){
    const code=catalogId(input.promotionCode).toUpperCase();
    const promo=catalog.promotions.find(p=>p.code===code);
    if(!promo||!promo.active||promo.startsAt>at||promo.endsAt<=at)
      catalogError('ORDER_PROMOTION_UNAVAILABLE','CONFLICT');
    const eligibleSubtotal=lines.filter(l=>!promo.eligibleItemIds.length||
      promo.eligibleItemIds.includes(l.catalogItemId)).reduce((s,l)=>sum(s,l.totalMinor),0);
    if(subtotalMinor<promo.minSubtotalMinor||eligibleSubtotal===0)
      catalogError('ORDER_PROMOTION_NOT_ELIGIBLE','CONFLICT');
    discountMinor=promo.kind==='FIXED'?
      Math.min(promo.amount,eligibleSubtotal):
      Math.floor(eligibleSubtotal*promo.amount/10000);
    discountMinor=money(discountMinor);
    appliedPromotion={code,discountMinor};
  }
  const totalMinor=sum(subtotalMinor-discountMinor,deliveryFeeMinor);
  return {lines,fulfillment,subtotalMinor,discountMinor,deliveryFeeMinor,
    totalMinor,...(appliedPromotion?{appliedPromotion}:{})};
}
