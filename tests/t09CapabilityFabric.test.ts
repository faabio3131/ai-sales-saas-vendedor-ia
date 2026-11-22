import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import type {BusinessProfileRevision,BusinessVertical,OperationMode,
 BusinessCapability} from '../src/business/model';
import type {BusinessProfileRepository} from '../src/business/contracts';
import type {CapabilityRepository,CapabilityAssignment,CapabilityId,
 CapabilityTemplateId} from '../src/capabilities/model';
import {CapabilityRegistryService} from '../src/capabilities/service';
import {CapabilityDispatcher} from '../src/capabilities/dispatcher';
import {capabilityManifest,capabilityTemplate,
 listCapabilityManifests,listCapabilityTemplates} from '../src/capabilities/catalog';
import {createCapabilitiesRouter} from '../src/capabilities/routes';
import {ApplicationError} from '../src/infrastructure/errors';
import {errorHandler} from '../src/api/middleware/errorHandler';
import type {TenantContext} from '../src/types/contracts';

const NOW='2026-11-21T16:00:00.000Z';
const k=(t:string,u:string)=>JSON.stringify([t,u]);
const ctx=(t:string,role='OWNER'):TenantContext=>({
 tenantId:t,userId:'actor-'+t,role,requestId:'t09-test',
});
function profile(t:string,u:string,vertical:BusinessVertical,
 capabilities:BusinessCapability[]=[],
 mode:OperationMode='NATIVE_OPERATIONS'):BusinessProfileRevision{
 return {tenantId:t,unitId:u,version:1,effectiveFrom:'2026-01-01T00:00:00.000Z',
  createdAt:NOW,createdBy:'owner',
  identity:{assistantName:'Atendente Personalizável',voiceStyle:'FRIENDLY'},
  capabilityRegistry:{vertical,capabilities,operationMode:mode,integrationStatus:'NOT_CONFIGURED'},
  policy:{timezone:'America/Sao_Paulo',locale:'pt-BR',memoryRetentionDays:90,
   personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},facts:[]};
}
class MemoryAssignments implements CapabilityRepository {
 readonly records=new Map<string,CapabilityAssignment[]>();
 private tail:Promise<void>=Promise.resolve();
 async locked<T>(action:()=>Promise<T> | T):Promise<T>{
  let release!:()=>void;const next=new Promise<void>(r=>{release=r;});
  const previous=this.tail;this.tail=previous.then(()=>next);await previous;
  try{return await action();}finally{release();}
 }
 async latest(t:string,u:string){
  const last=this.records.get(k(t,u))?.at(-1);
  return last?structuredClone(last):null;
 }
 async version(t:string,u:string,version:number){
  const item=this.records.get(k(t,u))?.find(x=>x.version===version);
  return item?structuredClone(item):null;
 }
 async publish(next:CapabilityAssignment,expected:number){
  return this.locked(()=>{
   const key=k(next.tenantId,next.unitId),list=this.records.get(key)??[];
   if(list.length!==expected||next.version!==expected+1)
    throw new ApplicationError({category:'CONFLICT',code:'CAPABILITY_VERSION_CONFLICT',
     message:'CAS rejected'});
   this.records.set(key,[...list,structuredClone(next)]);
  });
 }
}
const FOOD:BusinessCapability[]=['FOOD_SERVICE','ORDERING','PRODUCTION','DELIVERY'];
function environment(){
 const mapping=new Map<string,BusinessProfileRevision>();
 mapping.set(k('tenant-food','kitchen'),profile('tenant-food','kitchen','FOOD_SERVICE',FOOD));
 mapping.set(k('tenant-retail','shop'),profile('tenant-retail','shop','RETAIL'));
 mapping.set(k('tenant-beauty','salon'),profile('tenant-beauty','salon','BEAUTY'));
 mapping.set(k('tenant-services','office'),profile('tenant-services','office','SERVICES'));
 mapping.set(k('tenant-health','clinic'),profile('tenant-health','clinic','HEALTH_SERVICE'));
 mapping.set(k('tenant-general','hq'),profile('tenant-general','hq','OTHER'));
 const profiles:BusinessProfileRepository={
  latest:async(t,u)=>mapping.get(k(t,u))??null,
  effective:async(t,u,_)=>mapping.get(k(t,u))??null,
  createRevision:async()=>{},
 };
 const store=new MemoryAssignments(),open=new Set<string>();
 const active={hasOpenOrders:async(t:string,u:string)=>open.has(k(t,u))};
 const service=new CapabilityRegistryService(store,profiles,()=>new Date(NOW),active);
 return {service,store,profiles,mapping,open};
}
const prov=(expectedVersion:number,reason='Configuração inicial aprovada pela administração')=>({
 expectedVersion,reason,
});
const install=(expectedVersion:number,templateId:CapabilityTemplateId,
 enabledCapabilities:CapabilityId[],reason='Ativar apenas módulos internos autorizados')=>({
 expectedVersion,templateId,templateVersion:1 as const,enabledCapabilities,reason,
});

describe('T09 — catálogo horizontal e fronteiras contratuais de módulos',()=>{
 it('mantém manifests tipados, sem nomes de tenants/endereços/segredos e sem executar módulos planejados',()=>{
  const manifests=listCapabilityManifests(),templates=listCapabilityTemplates();
  expect(manifests).toHaveLength(16);expect(templates).toHaveLength(6);
  expect(new Set(manifests.map(m=>m.id)).size).toBe(manifests.length);
  const ids=new Set(manifests.map(m=>m.id));
  for(const m of manifests){
   for(const dependency of m.dependsOn)expect(ids.has(dependency)).toBe(true);
   if(m.maturity==='PLANNED')expect(m.certification).toBe('FUTURE_IMPLEMENTATION');
  }
  for(const t of templates){
   expect(t.capabilities.length).toBeGreaterThan(0);
   expect(new Set(t.capabilities).size).toBe(t.capabilities.length);
   for(const c of t.capabilities)expect(ids.has(c)).toBe(true);
   for(const c of t.defaultEnabled)expect(capabilityManifest(c)?.maturity).toBe('READY_INTERNAL');
  }
  expect(templates.map(t=>t.vertical).sort()).toEqual(
   ['BEAUTY','FOOD_SERVICE','HEALTH_SERVICE','OTHER','RETAIL','SERVICES']);
  expect(JSON.stringify({manifests,templates})).not.toMatch(/Pizzaria Americana|Cajamar|PIX_KEY|credentialRef/i);
  const altered=capabilityTemplate('RETAIL_STD')!;
  (altered.capabilities as CapabilityId[]).pop();
  expect(capabilityTemplate('RETAIL_STD')!.capabilities.length).toBe(6);
 });
 it('3 tenants diferentes: FOOD, RETAIL e BEAUTY gerenciam seleções privadas, sem contaminação do Core',async()=>{
  const f=environment();
  const food=await f.service.provisionDefaults(ctx('tenant-food'),'kitchen',prov(0));
  const retail=await f.service.provisionDefaults(ctx('tenant-retail'),'shop',prov(0));
  const beauty=await f.service.provisionDefaults(ctx('tenant-beauty'),'salon',prov(0));
  expect(food).toMatchObject({templateId:'FOOD_SERVICE_STD',vertical:'FOOD_SERVICE',
   version:1,state:'ENABLED_INTERNAL'});
  expect(retail).toMatchObject({templateId:'RETAIL_STD',vertical:'RETAIL',
   version:1,pendingCapabilities:[]});
  expect(beauty).toMatchObject({templateId:'BEAUTY_STD',vertical:'BEAUTY',
   version:1});
  expect(food.pendingCapabilities).toHaveLength(0);
  expect(retail.enabledCapabilities).toEqual(['CORE_CUSTOMERS','CORE_KNOWLEDGE']);
  expect(beauty.pendingCapabilities).not.toContain('BEAUTY_BOOKING');
  expect(beauty.pendingCapabilities).not.toContain('SCHEDULING');
  const f2=await f.service.publish(ctx('tenant-food'),'kitchen',install(1,
   'FOOD_SERVICE_STD',['CORE_KNOWLEDGE','FOOD_ORDERING','FOOD_PRODUCTION','FOOD_DELIVERY']));
  expect(f2.enabledCapabilities).toEqual(['CORE_KNOWLEDGE','FOOD_DELIVERY','FOOD_ORDERING','FOOD_PRODUCTION']);
  expect((await f.service.resolve(ctx('tenant-food'),'kitchen','FOOD_DELIVERY'))).toMatchObject({
   authorized:true,status:'ALLOWED_INTERNAL',commercialGoLiveAuthorized:false});
  expect((await f.service.resolve(ctx('tenant-retail'),'shop','FOOD_DELIVERY'))).toMatchObject({
   authorized:false,status:'NOT_ENABLED'});
  expect((await f.service.resolve(ctx('tenant-beauty'),'salon','SCHEDULING'))).toMatchObject({
   authorized:false,status:'NOT_ENABLED'});
  expect((await f.service.latest(ctx('tenant-retail'),'shop'))?.version).toBe(1);
  expect((await f.service.latest(ctx('tenant-beauty'),'salon'))?.version).toBe(1);
  expect((await f.service.latest(ctx('tenant-food'),'shop'))).toBeNull();
  expect((await f.service.latest(ctx('tenant-retail'),'kitchen'))).toBeNull();
  expect(f.store.records.size).toBe(3);
 });
 it('provisiona todas as seis verticais com seleção segura, sem cadastrar cliente no código',async()=>{
  const f=environment();
  for(const [t,u,template] of [
   ['tenant-services','office','SERVICES_STD'],
   ['tenant-health','clinic','HEALTH_ADMIN_STD'],
   ['tenant-general','hq','GENERAL_STD']
  ] as const){
   const result=await f.service.provisionDefaults(ctx(t),u,prov(0));
   expect(result.templateId).toBe(template);
   expect(result.enabledCapabilities).toEqual(['CORE_CUSTOMERS','CORE_KNOWLEDGE']);
   expect((await f.service.resolve(ctx(t),u,'CORE_KNOWLEDGE')).authorized).toBe(true);
  }
  expect((await f.service.resolve(ctx('tenant-health'),'clinic','HEALTH_ADMIN')).status)
   .toBe('NOT_ENABLED');
 });
 it('T12 habilita varejo somente com dependências e seleção explícita',async()=>{
  const f=environment();
  await expect(f.service.publish(ctx('tenant-retail'),'shop',install(0,'RETAIL_STD',['RETAIL_CHECKOUT'])))
   .rejects.toMatchObject({code:'CAPABILITY_DEPENDENCY_MISSING'});
  const a=await f.service.publish(ctx('tenant-retail'),'shop',install(0,'RETAIL_STD',['RETAIL_CATALOG','RETAIL_CHECKOUT','RETAIL_INVENTORY']));
  expect(a.pendingCapabilities).toEqual([]);
  expect((await f.service.resolve(ctx('tenant-retail'),'shop','RETAIL_CHECKOUT')).authorized).toBe(true);
 });
 it('valida dependências, políticas legadas de restaurante, duplicações e templates incompatíveis',async()=>{
  const f=environment();
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',install(0,'FOOD_SERVICE_STD',
   ['FOOD_PRODUCTION']))).rejects.toMatchObject({code:'CAPABILITY_DEPENDENCY_MISSING'});
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',install(0,'FOOD_SERVICE_STD',
   ['CORE_AI_ASSIST']))).rejects.toMatchObject({code:'CAPABILITY_DEPENDENCY_MISSING'});
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',install(0,'FOOD_SERVICE_STD',
   ['CORE_KNOWLEDGE','CORE_KNOWLEDGE']))).rejects.toMatchObject({code:'CAPABILITY_DUPLICATE_SELECTION'});
  await expect(f.service.publish(ctx('tenant-retail'),'shop',install(0,'FOOD_SERVICE_STD',
   ['CORE_KNOWLEDGE']))).rejects.toMatchObject({code:'CAPABILITY_VERTICAL_MISMATCH'});
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',install(0,'RETAIL_STD',
   ['CORE_KNOWLEDGE']))).rejects.toMatchObject({code:'CAPABILITY_VERTICAL_MISMATCH'});
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',install(0,'FOOD_SERVICE_STD',
   ['RETAIL_CATALOG']))).rejects.toMatchObject({code:'CAPABILITY_NOT_IN_TEMPLATE'});
  const p=f.mapping.get(k('tenant-food','kitchen'))!;
  p.capabilityRegistry.capabilities=['FOOD_SERVICE','ORDERING'];
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',install(0,
   'FOOD_SERVICE_STD',['CORE_KNOWLEDGE','FOOD_ORDERING','FOOD_DELIVERY'])))
   .rejects.toMatchObject({code:'CAPABILITY_LEGACY_POLICY_DENIED'});
  expect(f.store.records.size).toBe(0);
 });
 it('somente OWNER/ADMIN podem provisionar, alterar, rollback ou ler histórico privado',async()=>{
  const f=environment();
  await expect(f.service.provisionDefaults(ctx('tenant-food','MANAGER'),'kitchen',prov(0)))
   .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
  await expect(f.service.publish(ctx('tenant-food','VIEWER'),'kitchen',
   install(0,'FOOD_SERVICE_STD',['CORE_KNOWLEDGE'])))
   .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
  await expect(f.service.rollback(ctx('tenant-food','STAFF'),'kitchen',
   {expectedVersion:1,restoreVersion:1,reason:'Restaurar configuração anterior'}))
   .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
  await f.service.provisionDefaults(ctx('tenant-food'),'kitchen',prov(0));
  await expect(f.service.getVersion(ctx('tenant-food','ATTENDANT'),'kitchen',1))
   .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
  expect((await f.service.latest(ctx('tenant-food','VIEWER'),'kitchen'))?.version).toBe(1);
  expect((await f.service.resolve(ctx('tenant-food','STAFF'),'kitchen','CORE_KNOWLEDGE')).authorized).toBe(true);
  await expect(f.service.latest({tenantId:'tenant-food',requestId:'anon'},'kitchen'))
   .rejects.toMatchObject({code:'CAPABILITY_MEMBER_REQUIRED'});
 });
 it('valida objetos estritos, versões, campos extras e razão auditável',async()=>{
  const f=environment();
  for(const payload of [
   null,{expectedVersion:0,reason:'x',rogue:'admin'},
   {expectedVersion:'0',reason:'Atualizar dados'},
   {expectedVersion:0,reason:'too'},
  ]){
   await expect(f.service.provisionDefaults(ctx('tenant-food'),'kitchen',payload))
    .rejects.toMatchObject({category:'VALIDATION'});
  }
  const unsafe={expectedVersion:0,templateId:'FOOD_SERVICE_STD',
   templateVersion:1,enabledCapabilities:['CORE_KNOWLEDGE'],reason:'Motivo legítimo',
   tenantId:'tenant-retail'};
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',unsafe))
   .rejects.toMatchObject({code:'CAPABILITY_FIELDS_INVALID'});
  await expect(f.service.publish(ctx('tenant-food'),'kitchen',{
   ...install(0,'FOOD_SERVICE_STD',['CORE_KNOWLEDGE']),templateVersion:2,
  })).rejects.toMatchObject({code:'CAPABILITY_TEMPLATE_UNKNOWN'});
  await expect(f.service.resolve(ctx('tenant-food'),'kitchen','__proto__'))
   .rejects.toMatchObject({code:'CAPABILITY_UNKNOWN'});
 });
 it('migração food, rollback e desativação são bloqueados com pedidos ativos; outros setores seguem isolados',async()=>{
  const f=environment(),t=ctx('tenant-food');
  f.open.add(k('tenant-food','kitchen'));
  await expect(f.service.provisionDefaults(t,'kitchen',prov(0)))
   .rejects.toMatchObject({code:'CAPABILITY_ACTIVE_ORDERS_BLOCK_CHANGE'});
  // Uma ordem de alimentação nunca impede um tenant de varejo independente.
  await expect(f.service.provisionDefaults(ctx('tenant-retail'),'shop',prov(0)))
   .resolves.toMatchObject({version:1,templateId:'RETAIL_STD'});
  f.open.delete(k('tenant-food','kitchen'));
  await f.service.provisionDefaults(t,'kitchen',prov(0));
  await f.service.publish(t,'kitchen',install(1,'FOOD_SERVICE_STD',
    ['CORE_KNOWLEDGE','FOOD_ORDERING','FOOD_PRODUCTION']));
  f.open.add(k('tenant-food','kitchen'));
  await expect(f.service.publish(t,'kitchen',install(2,'FOOD_SERVICE_STD',
    ['CORE_KNOWLEDGE']))).rejects.toMatchObject({code:'CAPABILITY_ACTIVE_ORDERS_BLOCK_CHANGE'});
  await expect(f.service.rollback(t,'kitchen',{expectedVersion:2,
    restoreVersion:1,reason:'Rollback supervisionado com pedidos ainda abertos'}))
   .rejects.toMatchObject({code:'CAPABILITY_ACTIVE_ORDERS_BLOCK_CHANGE'});
  expect((await f.service.latest(t,'kitchen'))?.version).toBe(2);
  f.open.clear();
  expect((await f.service.rollback(t,'kitchen',{expectedVersion:2,
    restoreVersion:1,reason:'Rollback supervisionado após encerrar pedidos'})).version).toBe(3);
 });
  it('concorrência de atualização CAS: apenas uma revisão 2, sem perda silenciosa de estado',async()=>{
  const f=environment();
  await f.service.provisionDefaults(ctx('tenant-food'),'kitchen',prov(0));
  const submissions=await Promise.allSettled(Array.from({length:20},(_,i)=>
   f.service.publish(ctx('tenant-food'),'kitchen',install(1,'FOOD_SERVICE_STD',
    i%2?['CORE_KNOWLEDGE']:['CORE_KNOWLEDGE','CORE_CUSTOMERS'],
    'Mudança concorrente '+i+' aprovada pelo gestor'))));
  expect(submissions.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const rejected=submissions.filter(x=>x.status==='rejected');
  expect(rejected).toHaveLength(19);
  expect(rejected.every(x=>x.status==='rejected'&&(x.reason as ApplicationError).code==='CAPABILITY_VERSION_CONFLICT')).toBe(true);
  expect((await f.service.latest(ctx('tenant-food'),'kitchen'))?.version).toBe(2);
  expect(f.store.records.get(k('tenant-food','kitchen'))).toHaveLength(2);
 });
 it('rollback cria versão 3 imutável, restaura capabilities e preserva histórico/proveniência',async()=>{
  const f=environment(),t=ctx('tenant-food');
  const first=await f.service.provisionDefaults(t,'kitchen',prov(0));
  const second=await f.service.publish(t,'kitchen',install(1,'FOOD_SERVICE_STD',
   ['CORE_KNOWLEDGE','FOOD_ORDERING']));
  const rollback=await f.service.rollback(t,'kitchen',{
   expectedVersion:2,restoreVersion:1,reason:'Rollback aprovado após verificação do incidente'});
  expect(rollback).toMatchObject({
   version:3,rollbackOfVersion:1,
   enabledCapabilities:first.enabledCapabilities,
   state:'ENABLED_INTERNAL',createdBy:'actor-tenant-food',
  });
  expect((await f.service.getVersion(t,'kitchen',2)).enabledCapabilities)
   .toEqual(second.enabledCapabilities);
  expect((await f.service.getVersion(t,'kitchen',1)).rollbackOfVersion).toBeUndefined();
  expect((await f.service.resolve(t,'kitchen','FOOD_ORDERING')).authorized).toBe(false);
  expect((await f.service.resolve(t,'kitchen','CORE_KNOWLEDGE')).authorized).toBe(true);
  await expect(f.service.rollback(t,'kitchen',{
   expectedVersion:3,restoreVersion:3,reason:'Rollback inaceitável para mesma versão'}))
   .rejects.toMatchObject({code:'CAPABILITY_ROLLBACK_TARGET_INVALID'});
  await expect(f.service.rollback(t,'kitchen',{
   expectedVersion:2,restoreVersion:1,reason:'Tentativa de rollback obsoleto'}))
   .rejects.toMatchObject({code:'CAPABILITY_VERSION_CONFLICT'});
  await expect(f.service.rollback(t,'kitchen',{
   expectedVersion:3,restoreVersion:99,reason:'Rollback para versão não existente'}))
   .rejects.toMatchObject({code:'CAPABILITY_ROLLBACK_TARGET_INVALID'});
 });
 it('desativação internal é fail-closed; versões não ativam comercialmente o negócio',async()=>{
  const f=environment(),t=ctx('tenant-food');
  await f.service.provisionDefaults(t,'kitchen',prov(0));
  const off=await f.service.publish(t,'kitchen',install(1,'FOOD_SERVICE_STD',[],
   'Desligar capacidades da unidade por segurança'));
  expect(off).toMatchObject({state:'DISABLED',enabledCapabilities:[]});
  expect((await f.service.resolve(t,'kitchen','CORE_KNOWLEDGE'))).toMatchObject({
   status:'DISABLED',authorized:false,commercialGoLiveAuthorized:false});
  await expect(f.service.requireInternal(t,'kitchen','CORE_KNOWLEDGE'))
   .rejects.toMatchObject({code:'CAPABILITY_EXECUTION_NOT_AUTHORIZED'});
 });
 it('mudança T02 de vertical/modo torna seleção antiga inelegível até reprovisionamento validado',async()=>{
  const f=environment(),t=ctx('tenant-food');
  await f.service.provisionDefaults(t,'kitchen',prov(0));
  const p=f.mapping.get(k('tenant-food','kitchen'))!;
  p.capabilityRegistry.operationMode='INTEGRATED_OPERATIONS';
  expect((await f.service.resolve(t,'kitchen','CORE_KNOWLEDGE')).status)
   .toBe('TEMPLATE_MISMATCH');
  p.capabilityRegistry.operationMode='NATIVE_OPERATIONS';
  p.capabilityRegistry.vertical='RETAIL';
  expect((await f.service.resolve(t,'kitchen','CORE_KNOWLEDGE')).status)
   .toBe('TEMPLATE_MISMATCH');
  await expect(f.service.publish(t,'kitchen',install(1,'FOOD_SERVICE_STD',
   ['CORE_KNOWLEDGE']))).rejects.toMatchObject({code:'CAPABILITY_VERTICAL_MISMATCH'});
  await expect(f.service.publish(t,'kitchen',install(1,'RETAIL_STD',
   ['CORE_KNOWLEDGE']))).resolves.toMatchObject({templateId:'RETAIL_STD',version:2});
  expect((await f.service.resolve(t,'kitchen','CORE_KNOWLEDGE')).authorized).toBe(true);
 });
 it('owner não consegue atribuir capacidades a uma unidade inexistente ou cruzar contas',async()=>{
  const f=environment();
  await expect(f.service.provisionDefaults(ctx('tenant-food'),'shop',prov(0)))
   .rejects.toMatchObject({code:'CAPABILITY_CURRENT_PROFILE_REQUIRED'});
  await expect(f.service.provisionDefaults(ctx('tenant-retail'),'kitchen',prov(0)))
   .rejects.toMatchObject({code:'CAPABILITY_CURRENT_PROFILE_REQUIRED'});
  await expect(f.service.provisionDefaults(ctx('tenant-food'),'../kitchen',prov(0)))
   .rejects.toMatchObject({code:'BUSINESS_UNIT_INVALID'});
  await f.service.provisionDefaults(ctx('tenant-food'),'kitchen',prov(0));
  await expect(f.service.getVersion(ctx('tenant-retail'),'kitchen',1))
   .rejects.toMatchObject({code:'CAPABILITY_REVISION_NOT_FOUND'});
 });
 it('dispatcher injeta somente contexto comprovado e não chama módulos externos, futuros ou de outros tenants',async()=>{
  const f=environment();
  await f.service.provisionDefaults(ctx('tenant-food'),'kitchen',prov(0));
  await f.service.provisionDefaults(ctx('tenant-retail'),'shop',prov(0));
  const execute=vi.fn(async(scope:{tenantId:string;unitId:string},input:unknown)=>({
   tenant:scope.tenantId,unit:scope.unitId,result:input,
  }));
  const d=new CapabilityDispatcher(f.service,[
   {capability:'CORE_KNOWLEDGE',execute},
   {capability:'FOOD_PRODUCTION',execute},
   {capability:'RETAIL_CHECKOUT',execute},
  ]);
  expect(await d.invoke(ctx('tenant-food'),'kitchen','CORE_KNOWLEDGE',{question:'horário'}))
   .toMatchObject({tenant:'tenant-food',unit:'kitchen'});
  expect(await d.invoke(ctx('tenant-retail'),'shop','CORE_KNOWLEDGE',{question:'estoque'}))
   .toMatchObject({tenant:'tenant-retail',unit:'shop'});
  await expect(d.invoke(ctx('tenant-retail'),'shop','FOOD_PRODUCTION',{}))
   .rejects.toMatchObject({code:'CAPABILITY_EXECUTION_NOT_AUTHORIZED'});
  await expect(d.invoke(ctx('tenant-retail'),'shop','RETAIL_CHECKOUT',{}))
   .rejects.toMatchObject({code:'CAPABILITY_EXECUTION_NOT_AUTHORIZED'});
  await expect(d.invoke(ctx('tenant-food'),'shop','CORE_KNOWLEDGE',{}))
   .rejects.toMatchObject({code:'CAPABILITY_EXECUTION_NOT_AUTHORIZED'});
  await expect(d.invoke(ctx('tenant-food'),'kitchen','CORE_CUSTOMERS',{}))
   .rejects.toMatchObject({code:'CAPABILITY_HANDLER_UNAVAILABLE'});
  expect(execute).toHaveBeenCalledTimes(2);
  expect(()=>new CapabilityDispatcher(f.service,[
   {capability:'CORE_KNOWLEDGE',execute},
   {capability:'CORE_KNOWLEDGE',execute},
  ])).toThrow('CAPABILITY_DISPATCHER_CONFIGURATION_INVALID');
 });
 it('endpoint HTTP exige contexto validado, respeita papéis e isola dados por tenant',async()=>{
  const f=environment(),app=express();app.use(express.json());
  app.use('/capabilities',(req,_res,next)=>{
   const tenant=req.header('x-test-tenant');
   if(tenant&&tenant!=='NO_AUTH')req.tenantContext=ctx(tenant,
     req.header('x-test-role')??'OWNER');
   next();
  },createCapabilitiesRouter(f.store,f.profiles,{hasOpenOrders:async()=>false}));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const path='http://127.0.0.1:'+(server.address() as AddressInfo).port+
     '/capabilities/units/kitchen';
   const request=async(resource:string,options:RequestInit={})=>{
    const headers=new Headers(options.headers);
    if(!headers.has('x-test-tenant'))headers.set('x-test-tenant','tenant-food');
    if(!headers.has('x-tenant-id'))headers.set('x-tenant-id','tenant-food');
    if(!headers.has('content-type'))headers.set('content-type','application/json');
    const res=await fetch(path+resource,{...options,headers,signal:AbortSignal.timeout(4000)});
    return {res,data:await res.json()};
   };
   expect((await request('/catalog',{headers:{'x-test-tenant':'NO_AUTH'}})).res.status).toBe(403);
   expect((await request('/assignment')).data.data).toBeNull();
   const denied=await request('/provision-defaults',{method:'POST',
    headers:{'x-test-role':'VIEWER'},body:JSON.stringify(prov(0))});
   expect(denied.res.status).toBe(403);
   const created=await request('/provision-defaults',{method:'POST',body:JSON.stringify(prov(0))});
   expect(created.res.status).toBe(201);
   expect(created.data.data.templateId).toBe('FOOD_SERVICE_STD');
   expect((await request('/assignment')).data.data.version).toBe(1);
   expect((await request('/resolve/CORE_KNOWLEDGE')).data.data.authorized).toBe(true);
   const other=await request('/assignment',{headers:{'x-test-tenant':'tenant-retail'}});
   expect(other.data.data).toBeNull();
   expect((await request('/revisions/1',{headers:{'x-test-tenant':'tenant-retail'}})).res.status).toBe(404);
   expect((await request('/revisions/1',{headers:{'x-test-role':'VIEWER'}})).res.status).toBe(403);
   expect((await request('/resolve/SCHEDULING')).data.data.authorized).toBe(false);
   expect((await request('/catalog')).data.data.templates).toHaveLength(6);
   const changed=await request('/revisions',{method:'POST',
    body:JSON.stringify(install(1,'FOOD_SERVICE_STD',['CORE_KNOWLEDGE','FOOD_ORDERING']))});
   expect(changed.res.status).toBe(201);
   expect(changed.data.data.version).toBe(2);
   const rollback=await request('/rollback',{method:'POST',
    body:JSON.stringify({expectedVersion:2,restoreVersion:1,
     reason:'Retornar para baseline anterior aprovado'})});
   expect(rollback.res.status).toBe(201);
   expect(rollback.data.data).toMatchObject({version:3,rollbackOfVersion:1});
  }finally{
    await new Promise<void>((resolve,reject)=>{
      server.close(err=>err?reject(err):resolve());
      server.closeAllConnections();
    });
   }
 },15000);
});
