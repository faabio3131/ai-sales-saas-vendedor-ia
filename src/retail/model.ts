import type {CapabilityId} from '../capabilities/model';
export interface Scope{tenantId:string;unitId:string}
export interface RetailItem{id:string;sku:string;name:string;category:string;active:boolean;priceMinor:number;trackStock:boolean}
export interface RetailCatalog extends Scope{version:number;items:RetailItem[];updatedAt:string;updatedBy:string}
export interface Stock{itemId:string;onHand:number;reserved:number;version:number}
export interface RetailLine{itemId:string;sku:string;name:string;quantity:number;unitPriceMinor:number;totalMinor:number;trackStock:boolean}
export type RetailStatus='CART'|'CONFIRMED'|'COMPLETED'|'CANCELLED';
export interface RetailPayment{state:'UNPAID'|'CREATING'|'PENDING'|'VERIFIED'|'MANUAL_RECORDED'|'REVIEW_REQUIRED'|'REFUNDED';
 method?:'CASH'|'CARD'|'PIX_MANUAL'|'PIX';provider?:string;providerPaymentId?:string;referenceId?:string;pixCode?:string;
 evidenceRef?:string;recordedBy?:string;verifiedAt?:string}
export interface RetailOrder extends Scope{
 id:string;version:number;catalogVersion:number;customerId:string;status:RetailStatus;
 lines:RetailLine[];totalMinor:number;currency:'BRL';payment:RetailPayment;
 createdAt:string;updatedAt:string;actorId:string;confirmedAt?:string;completedAt?:string;
 acceptedTotalMinor?:number;acceptanceRef?:string;cancelReason?:string;
}
export interface Receipt{fingerprint:string;orderId:string}
export interface RetailTransaction{
 grant(capabilities:CapabilityId[],now:number,native:boolean,feature?:'PAYMENTS'):Promise<boolean>;
 catalog():Promise<RetailCatalog|null>;
 stock(itemId:string):Promise<Stock|null>;
 order(id:string):Promise<RetailOrder|null>;
 receipt(key:string):Promise<Receipt|null>;
 active():Promise<boolean>;
 orders(start:string,end:string):Promise<RetailOrder[]>;
 saveCatalog(c:RetailCatalog):void;saveStock(s:Stock):void;
 saveOrder(o:RetailOrder):void;saveReceipt(key:string,r:Receipt):void;
 saveMovement(id:string,row:{itemId:string;before:Stock;after:Stock;actorId:string;reason:string;at:string}):void;
}
export interface RetailRepository{transact<T>(s:Scope,work:(tx:RetailTransaction)=>Promise<T>):Promise<T>}
