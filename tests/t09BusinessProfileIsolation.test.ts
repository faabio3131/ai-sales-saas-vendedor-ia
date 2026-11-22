import {describe,it,expect} from 'vitest';
import type {BusinessProfileRevision,BusinessProfileInput,BusinessVertical} from '../src/business/model';
import type {BusinessProfileRepository} from '../src/business/contracts';
import {BusinessProfileService} from '../src/business/service';
import {blocksActiveFoodOperations} from '../src/capabilities/operationalState';
import type {CapabilityAssignment} from '../src/capabilities/model';
import type {TenantContext} from '../src/types/contracts';
const NOW='2026-11-21T16:00:00.000Z';
const context=(tenantId:string):TenantContext=>({tenantId,userId:'owner',role:'OWNER',requestId:'test'});
const k=(t:string,u:string)=>JSON.stringify([t,u]);
function input(vertical:BusinessVertical):BusinessProfileInput{
 return {expectedVersion:0,effectiveFrom:NOW,
  identity:{assistantName:'Atendente Personalizável',voiceStyle:'FRIENDLY'},
  capabilityRegistry:{vertical,operationMode:'NATIVE_OPERATIONS',
   capabilities:[],integrationStatus:'NOT_CONFIGURED'},
  policy:{timezone:'America/Sao_Paulo',locale:'pt-BR',
   memoryRetentionDays:90,personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},
  facts:[]};
}
class Profiles implements BusinessProfileRepository{
 readonly rows=new Map<string,BusinessProfileRevision>();
 async latest(t:string,u:string){return this.rows.get(k(t,u))??null;}
 async effective(t:string,u:string,at:string){
  const rev=await this.latest(t,u);return rev&&rev.effectiveFrom<=at?rev:null;
 }
 async createRevision(r:BusinessProfileRevision,expected:number){
  const key=k(r.tenantId,r.unitId);
  if((this.rows.get(key)?.version??0)!==expected)throw Error('cas');
  this.rows.set(key,structuredClone(r));
 }
}
function assignment(overrides:Partial<CapabilityAssignment>={}):CapabilityAssignment{
 return {schemaVersion:1,tenantId:'food',unitId:'kitchen',version:1,
  templateId:'FOOD_SERVICE_STD',templateVersion:1,vertical:'FOOD_SERVICE',
  enabledCapabilities:['CORE_KNOWLEDGE','FOOD_ORDERING','FOOD_PRODUCTION'],
  pendingCapabilities:[],state:'ENABLED_INTERNAL',operationMode:'NATIVE_OPERATIONS',
  profileVersion:1,createdAt:NOW,createdBy:'owner',reason:'Inicialização controlada',
  ...overrides};
}
describe('T09 — integridade T02/T09 e segurança da migração por setor',()=>{
 it('não contamina retail, beauty ou health com capacidades antigas de cozinha/delivery',async()=>{
  const repo=new Profiles(),service=new BusinessProfileService(repo);
  for(const [tenant,unit,vertical,foodCapability] of [
   ['retail','shop','RETAIL','ORDERING'],
   ['beauty','salon','BEAUTY','PRODUCTION'],
   ['health','clinic','HEALTH_SERVICE','DELIVERY'],
  ] as const){
   await expect(service.publish(context(tenant),unit,{
    ...input(vertical),capabilityRegistry:{...input(vertical).capabilityRegistry,
      capabilities:[foodCapability]},
   })).rejects.toMatchObject({code:'BUSINESS_VERTICAL_CAPABILITY_CONFLICT'});
   expect(await repo.latest(tenant,unit)).toBeNull();
   const valid=await service.publish(context(tenant),unit,input(vertical));
   expect(valid.capabilityRegistry).toMatchObject({vertical,capabilities:[]});
  }
  expect(repo.rows.size).toBe(3);
 });
 it('não permite FOOD_ORDERING, PRODUCTION ou DELIVERY sem capability base FOOD_SERVICE',async()=>{
  const service=new BusinessProfileService(new Profiles());
  for(const legacy of ['ORDERING','PRODUCTION','DELIVERY'] as const){
   await expect(service.publish(context('food'),'kitchen',{
    ...input('FOOD_SERVICE'),
    capabilityRegistry:{...input('FOOD_SERVICE').capabilityRegistry,
     capabilities:[legacy]},
   })).rejects.toMatchObject({code:'BUSINESS_FOOD_CAPABILITY_DEPENDENCY'});
  }
  await expect(service.publish(context('food'),'kitchen',{
   ...input('FOOD_SERVICE'),
   capabilityRegistry:{...input('FOOD_SERVICE').capabilityRegistry,
    capabilities:['FOOD_SERVICE','ORDERING','PRODUCTION','DELIVERY']},
  })).resolves.toMatchObject({version:1});
 });
 it('T02 mantém cadastro e fatos versionados sem vazamento entre empresas',async()=>{
  const repo=new Profiles(),service=new BusinessProfileService(repo);
  const shop=await service.publish(context('retail'),'shop',input('RETAIL'));
  const salon=await service.publish(context('beauty'),'salon',input('BEAUTY'));
  expect(shop.capabilityRegistry.vertical).toBe('RETAIL');
  expect(salon.capabilityRegistry.vertical).toBe('BEAUTY');
  expect(await service.effective(context('retail'),'salon',NOW)).toBeNull();
  expect(await service.effective(context('beauty'),'shop',NOW)).toBeNull();
  await expect(service.publish({...context('retail'),role:'STAFF'},'shop',{
   ...input('RETAIL'),expectedVersion:1,effectiveFrom:'2026-11-22T16:00:00.000Z',
  })).rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
 });
 it('cerca de segurança detecta edição food, troca de vertical/modo e reordenação',()=>{
  const initial=assignment();
  expect(blocksActiveFoodOperations(undefined,initial)).toBe(true);
  expect(blocksActiveFoodOperations(initial,assignment({version:2,
   enabledCapabilities:['CORE_KNOWLEDGE']}))).toBe(true);
  expect(blocksActiveFoodOperations(initial,assignment({version:2,
   operationMode:'INTEGRATED_OPERATIONS'}))).toBe(true);
  expect(blocksActiveFoodOperations(initial,assignment({version:2,
   vertical:'RETAIL',templateId:'RETAIL_STD'}))).toBe(true);
  expect(blocksActiveFoodOperations(initial,assignment({version:2,
   enabledCapabilities:[...initial.enabledCapabilities].reverse()}))).toBe(false);
  expect(blocksActiveFoodOperations(assignment({vertical:'RETAIL',templateId:'RETAIL_STD'}),
   assignment({vertical:'RETAIL',templateId:'RETAIL_STD',version:2}))).toBe(false);
 });
});
