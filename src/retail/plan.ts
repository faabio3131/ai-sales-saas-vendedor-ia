import type {Subscription,FeatureCode} from '../plans/model';
import {getPlanDefinition} from '../plans/catalog';
export function activePlan(sub:Subscription|null|undefined,tenantId:string,now:number){
 if(!sub||sub.tenantId!==tenantId||sub.status!=='ACTIVE'||!['BASIC','STANDARD','PRO','PREMIUM'].includes(sub.planCode))return null;
 const start=Date.parse(sub.periodStart),end=Date.parse(sub.periodEnd);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now)return null;
 return getPlanDefinition(sub.planCode);
}
export function planAllows(sub:Subscription|null|undefined,t:string,now:number,feature:FeatureCode='MULTISECTOR_OPERATIONS'){
 return activePlan(sub,t,now)?.features.includes(feature)===true;
}
