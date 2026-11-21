import {ApplicationError} from '../infrastructure/errors';
import type {TenantContext} from '../types/contracts';
import type {BusinessProfileRepository} from '../business/contracts';
import {requireBusinessScope} from '../business/service';
import type {FinancePeriod,FinanceSettingsRepository,FinanceSourceRepository,
  FinanceSnapshot,FinanceUnitSettings} from './model';
import {resolveWindow} from './calendar';
import {computeCommercialSnapshot} from './metrics';

function fail(code:string,category:'VALIDATION'|'FORBIDDEN'|'CONFLICT'='VALIDATION'):never{
 throw new ApplicationError({category,code,message:'Financial administration request denied or invalid.'});
}
export function requireFinanceAdmin(context:TenantContext):void{
 if(!context.tenantId||!context.userId||!['OWNER','ADMIN'].includes(context.role??''))
  fail('FINANCE_ADMIN_ACCESS_DENIED','FORBIDDEN');
}
export class FinancialService {
 constructor(private readonly sources:FinanceSourceRepository,
   private readonly profiles:BusinessProfileRepository,
   private readonly settings:FinanceSettingsRepository,
   private readonly clock:()=>Date=()=>new Date()){}
 private scope(ctx:TenantContext,unitId:string){
  requireFinanceAdmin(ctx);
  return requireBusinessScope(ctx,unitId);
 }
 async getSettings(ctx:TenantContext,unitId:string):Promise<FinanceUnitSettings>{
  const s=this.scope(ctx,unitId);
  return (await this.settings.get(s.tenantId,s.unitId))??{
   ...s,version:0,weekStartsOn:1,updatedAt:'',updatedBy:'',
  };
 }
 async setSettings(ctx:TenantContext,unitId:string,input:unknown):Promise<FinanceUnitSettings>{
  const s=this.scope(ctx,unitId);
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join(',')!=='expectedVersion,weekStartsOn')
    fail('FINANCE_SETTINGS_INVALID');
  const raw=input as {expectedVersion?:unknown;weekStartsOn?:unknown};
  if(!Number.isSafeInteger(raw.expectedVersion)||Number(raw.expectedVersion)<0||
    !Number.isInteger(raw.weekStartsOn)||Number(raw.weekStartsOn)<0||
    Number(raw.weekStartsOn)>6)fail('FINANCE_SETTINGS_INVALID');
  const expected=Number(raw.expectedVersion);
  const next={...s,version:expected+1,weekStartsOn:Number(raw.weekStartsOn),
   updatedAt:this.clock().toISOString(),updatedBy:ctx.userId!};
  return this.settings.update(next,expected);
 }
 async snapshot(ctx:TenantContext,unitId:string,input:{
  period?:unknown;anchor?:unknown;
 }={}):Promise<FinanceSnapshot>{
  const scope=this.scope(ctx,unitId);
  const period=input.period??'day';
  if(!['day','week','month'].includes(String(period))||
    typeof period!=='string')fail('FINANCE_PERIOD_INVALID');
  if(input.anchor!==undefined&&typeof input.anchor!=='string')
    fail('FINANCE_ANCHOR_INVALID');
  const now=this.clock();
  const profile=await this.profiles.effective(scope.tenantId,scope.unitId,now.toISOString());
  if(!profile||profile.tenantId!==scope.tenantId||
    profile.unitId!==scope.unitId)fail('FINANCE_BUSINESS_PROFILE_REQUIRED','CONFLICT');
  const preferences=await this.getSettings(ctx,unitId);
  const window=resolveWindow({period:period as FinancePeriod,
   anchor:input.anchor as string|undefined,timezone:profile.policy.timezone,
   weekStartsOn:preferences.weekStartsOn,now});
  const sources=await this.sources.read(scope.tenantId,scope.unitId);
  return computeCommercialSnapshot({...scope,window,sources});
 }
}
