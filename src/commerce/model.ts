/** T03 — Catalog and Food Pack. All monetary amounts are integer BRL cents. */
export type CatalogKind = 'ITEM' | 'PIZZA' | 'COMBO';
export type HalfHalfPricingRule = 'MAX_FLAVOR' | 'AVERAGE_CEIL';
export interface CatalogChoice {id:string;name:string;active:boolean;priceMinor:number;}
export interface PizzaSize {id:string;name:string;active:boolean;}
export interface PizzaFlavor {
  id:string;name:string;active:boolean;
  /** Exact price per size (cents); absent size is unavailable, never free. */
  pricesBySize:Record<string,number>;
}
export interface PizzaBorder {
  id:string;name:string;active:boolean;
  pricesBySize:Record<string,number>;
}
export interface PizzaAddon {
  id:string;name:string;active:boolean;
  pricesBySize:Record<string,number>;
}
export interface PizzaOptions {
  sizes:PizzaSize[];
  flavors:PizzaFlavor[];
  borders:PizzaBorder[];
  addons:PizzaAddon[];
  maxFlavors:1|2;
  halfHalfPricing:HalfHalfPricingRule;
}
export interface ComboComponent {itemId:string;quantity:number;}
export interface UnitCatalogItem {
  id:string;name:string;active:boolean;kind:CatalogKind;
  /** Fixed single-item/COMBO price. No free-form client prices are accepted. */
  priceMinor?:number;
  variants?:CatalogChoice[];
  addons?:CatalogChoice[];
  pizza?:PizzaOptions;
  components?:ComboComponent[];
}
export interface DeliveryZone {
  id:string;name:string;active:boolean;feeMinor:number;
}
export interface CatalogPromotion {
  code:string;active:boolean;startsAt:string;endsAt:string;
  kind:'FIXED'|'PERCENT_BPS';
  amount:number;
  minSubtotalMinor:number;
  /** Empty array = all catalog items; nonempty = exact eligible SKUs. */
  eligibleItemIds:string[];
}
export interface UnitCatalogRevision {
  tenantId:string;unitId:string;version:number;
  effectiveFrom:string;expiresAt?:string;
  createdAt:string;createdBy:string;currency:'BRL';
  items:UnitCatalogItem[];
  deliveryZones:DeliveryZone[];
  promotions:CatalogPromotion[];
}
export interface UnitCatalogInput {
  expectedVersion:number;effectiveFrom:string;expiresAt?:string|null;
  items:UnitCatalogItem[];deliveryZones:DeliveryZone[];promotions:CatalogPromotion[];
}
export interface UnitCatalogRepository {
  latest(tenantId:string,unitId:string):Promise<UnitCatalogRevision|null>;
  effective(tenantId:string,unitId:string,asOf:string):Promise<UnitCatalogRevision|null>;
  createRevision(revision:UnitCatalogRevision,expectedVersion:number):Promise<void>;
}
