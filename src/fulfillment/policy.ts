import {ApplicationError} from '../infrastructure/errors';
import {requireBusinessScope} from '../business/service';
import type {TenantContext} from '../types/contracts';
import type {UnitCatalogRevision} from '../commerce/model';
import type {Order} from '../orders/model';
import type {OperationMode} from '../business/model';
import type {UnitFulfillmentSettings,UnitFulfillmentSettingsInput,DeliveryAssessment,
  OperationRecord,OperationState} from './model';

export function rejected(code:string,category:'VALIDATION'|'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'PROVIDER'='CONFLICT'):never{
  throw new ApplicationError({category,code,message:'Production or delivery operation was not authorized or cannot be validated.'});
}
export function operationalScope(ctx:TenantContext,unitId:string,allowed:string[]):{
  tenantId:string;unitId:string
}{
  if(!ctx.userId?.trim()||!allowed.includes(ctx.role??''))
    rejected('FULFILLMENT_ROLE_DENIED','FORBIDDEN');
  return requireBusinessScope(ctx,unitId);
}
export const VIEW=['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT','STAFF'];
export const RELEASE=['OWNER','ADMIN','MANAGER','OPERATOR','ATTENDANT'];
export const KITCHEN=['OWNER','ADMIN','MANAGER','OPERATOR','STAFF'];
export const DELIVERY=['OWNER','ADMIN','MANAGER','OPERATOR','STAFF'];
export const ADMIN=['OWNER','ADMIN'];
function strictKeys(value:object,keys:string[]):void{
  if(Object.keys(value).some(x=>!keys.includes(x)))
    rejected('FULFILLMENT_FIELDS_INVALID','VALIDATION');
}
function minutes(value:unknown):number{
  if(!Number.isInteger(value)||Number(value)<1||Number(value)>240)
    rejected('FULFILLMENT_MINUTES_INVALID','VALIDATION');
  return Number(value);
}
function validCep(value:unknown):string{
  if(typeof value!=='string'||!/^\d{8}$/.test(value))
    rejected('FULFILLMENT_CEP_INVALID','VALIDATION');
  return value;
}
const VALID_ID=/^[A-Za-z0-9_-]{1,96}$/;
export function parseSettings(scope:{tenantId:string;unitId:string},input:UnitFulfillmentSettingsInput,
 actorId:string,now:string):UnitFulfillmentSettings{
  if(!input||typeof input!=='object'||Array.isArray(input))
    rejected('FULFILLMENT_SETTINGS_INVALID','VALIDATION');
  strictKeys(input,['expectedVersion','operationMode','postalRanges','prepMinutes',
    'deliveryMinutes','pickupMinutes','connectorId']);
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||
    !['NATIVE_OPERATIONS','INTEGRATED_OPERATIONS'].includes(input.operationMode))
    rejected('FULFILLMENT_SETTINGS_INVALID','VALIDATION');
  if(!Array.isArray(input.postalRanges)||input.postalRanges.length>60)
    rejected('FULFILLMENT_POSTAL_RANGES_INVALID','VALIDATION');
  const ranges=input.postalRanges.map(raw=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))
      rejected('FULFILLMENT_POSTAL_RANGES_INVALID','VALIDATION');
    strictKeys(raw,['zoneId','fromCep','toCep']);
    if(typeof raw.zoneId!=='string'||!VALID_ID.test(raw.zoneId))
      rejected('FULFILLMENT_ZONE_INVALID','VALIDATION');
    const fromCep=validCep(raw.fromCep),toCep=validCep(raw.toCep);
    if(fromCep>toCep)rejected('FULFILLMENT_POSTAL_RANGES_INVALID','VALIDATION');
    return {zoneId:raw.zoneId,fromCep,toCep};
  }).sort((a,b)=>a.fromCep.localeCompare(b.fromCep));
  for(let i=1;i<ranges.length;i++){
    if(ranges[i].fromCep<=ranges[i-1].toCep)
      rejected('FULFILLMENT_POSTAL_RANGES_OVERLAP','VALIDATION');
  }
  if(input.connectorId!==undefined&&
    (typeof input.connectorId!=='string'||!VALID_ID.test(input.connectorId)))
    rejected('FULFILLMENT_CONNECTOR_INVALID','VALIDATION');
  if(input.operationMode==='INTEGRATED_OPERATIONS'&&!input.connectorId)
    rejected('FULFILLMENT_CONNECTOR_REQUIRED','VALIDATION');
  if(input.operationMode==='NATIVE_OPERATIONS'&&input.connectorId!==undefined)
    rejected('FULFILLMENT_NATIVE_CONNECTOR_FORBIDDEN','VALIDATION');
  return {
    ...scope,version:input.expectedVersion+1,operationMode:input.operationMode,
    postalRanges:ranges,prepMinutes:minutes(input.prepMinutes),
    deliveryMinutes:minutes(input.deliveryMinutes),pickupMinutes:minutes(input.pickupMinutes),
    ...(input.connectorId?{connectorId:input.connectorId}:{}),
    activeOperations:0,createdBy:actorId,updatedAt:now,
  };
}
export function extractCep(address:string):string{
  if(typeof address!=='string'||address.length<12||address.length>300||
    /[\u0000-\u001f]/.test(address))
    rejected('FULFILLMENT_ADDRESS_INVALID','VALIDATION');
  const matches=[...address.matchAll(/(?:^|\D)(\d{5})-?(\d{3})(?!\d)/g)];
  if(matches.length!==1)rejected('FULFILLMENT_ADDRESS_CEP_REQUIRED','VALIDATION');
  return matches[0][1]+matches[0][2];
}
export function assessDelivery(order:Pick<Order,'fulfillment'|'deliveryFeeMinor'>,
  settings:UnitFulfillmentSettings,catalog:UnitCatalogRevision):DeliveryAssessment{
  if(order.fulfillment.kind==='PICKUP'){
    if(order.deliveryFeeMinor!==0)
      rejected('FULFILLMENT_PICKUP_FEE_INVALID');
    return {kind:'PICKUP',accepted:true,feeMinor:0,
      etaMinutes:settings.prepMinutes+settings.pickupMinutes,
      etaSource:'MERCHANT_CONFIGURED_WINDOW',gpsValidated:false,liveTrackingAvailable:false};
  }
  const fulfillment=order.fulfillment;
  if(fulfillment.kind!=='DELIVERY'||!fulfillment.zoneId||
    typeof fulfillment.address!=='string')
    rejected('FULFILLMENT_ADDRESS_INVALID','VALIDATION');
  const cep=extractCep(fulfillment.address);
  const eligible=settings.postalRanges.filter(r=>r.zoneId===fulfillment.zoneId&&
    cep>=r.fromCep&&cep<=r.toCep);
  if(eligible.length!==1)rejected('FULFILLMENT_OUTSIDE_COVERAGE');
  const zone=catalog.deliveryZones.find(x=>x.id===fulfillment.zoneId&&x.active);
  if(!zone)rejected('FULFILLMENT_ZONE_INACTIVE');
  // The agreed fee is the immutable T03 order snapshot. Never reprice a
  // customer-confirmed or already-paid order due to a later catalog revision.
  if(!Number.isSafeInteger(order.deliveryFeeMinor)||order.deliveryFeeMinor<0)
    rejected('FULFILLMENT_DELIVERY_FEE_INVALID');
  return {
    kind:'DELIVERY',accepted:true,zoneId:fulfillment.zoneId,cep,
    address:fulfillment.address,feeMinor:order.deliveryFeeMinor,
    etaMinutes:settings.prepMinutes+settings.deliveryMinutes,
    etaSource:'MERCHANT_CONFIGURED_WINDOW',gpsValidated:false,liveTrackingAvailable:false,
  };
}
export function canAdvance(mode:OperationMode,current:OperationRecord,
 next:OperationState):boolean{
  if(mode==='INTEGRATED_OPERATIONS')return false; // trusted adapter worker only
  if(current.state==='QUEUED')return next==='IN_PREPARATION';
  if(current.state==='IN_PREPARATION')return next==='READY';
  if(current.state==='READY'){
    return current.fulfillment.kind==='PICKUP'?next==='COMPLETED':next==='OUT_FOR_DELIVERY';
  }
  if(current.state==='OUT_FOR_DELIVERY')return next==='COMPLETED';
  return false;
}
export function stateProjection(state:OperationState,kind:'PICKUP'|'DELIVERY'):{
  productionState:OperationRecord['productionState'];deliveryState:OperationRecord['deliveryState']
}{
  const prod=state==='IN_PREPARATION'?'IN_PREPARATION':
    state==='READY'?'READY':state==='AWAITING_ACK'?'AWAITING_ACK':
    state==='MANUAL_REVIEW_REQUIRED'?'MANUAL_REVIEW_REQUIRED':
    state==='COMPLETED'?'COMPLETED':state==='OUT_FOR_DELIVERY'?'READY':'QUEUED';
  const delivery=state==='COMPLETED'?(kind==='PICKUP'?'PICKED_UP':'COMPLETED'):
    state==='OUT_FOR_DELIVERY'?'OUT_FOR_DELIVERY':'NOT_STARTED';
  return {productionState:prod,deliveryState:delivery};
}
export function eventFor(state:OperationState,kind:'PICKUP'|'DELIVERY'):{
 name:import('./model').OperationEventName;notify:boolean
}{
  switch(state){
    case 'QUEUED':return {name:'OrderReleasedToProduction',notify:false};
    case 'IN_PREPARATION':return {name:'ProductionStarted',notify:false};
    case 'READY':return {name:'OrderReady',notify:true};
    case 'OUT_FOR_DELIVERY':return {name:'DeliveryDispatched',notify:true};
    case 'COMPLETED':return {name:kind==='PICKUP'?'OrderPickupCompleted':'DeliveryCompleted',notify:true};
    case 'MANUAL_REVIEW_REQUIRED':return {name:'ProductionDispatchEscalated',notify:false};
    default:return {name:'ProductionDispatchRequested',notify:false};
  }
}
