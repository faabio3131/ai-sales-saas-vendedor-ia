import {describe,it,expect} from 'vitest';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import type {TenantContext} from '../src/types/contracts';
import type {BusinessProfileRevision} from '../src/business/model';
import type {UnitCatalogRevision} from '../src/commerce/model';
import type {PilotRegistrationRecord,PilotRegistrationRepository,
 PilotRegistrationDraft} from '../src/pilot/onboarding/model';
import {defaultPilotDraft,ATTESTATION_STATEMENT} from '../src/pilot/onboarding/validation';
import {PilotRegistrationService} from '../src/pilot/onboarding/service';
import {createPilotOnboardingRouter} from '../src/pilot/onboarding/routes';
import {errorHandler} from '../src/api/middleware/errorHandler';
import {UnitCatalogService} from '../src/commerce/service';
import {catalogInput,InMemoryCatalog,profiles as t03Profiles,ctx as t03Ctx,NOW} from './helpers/t03Fixtures';

const t=(tenantId='pizza-a',role='OWNER',userId='owner_111'):TenantContext=>
 ({tenantId,role,userId,requestId:'owner-request-111'});
const CODE='owner-approval:explicit-20261121';
const consent={expectedVersion:2,statement:ATTESTATION_STATEMENT,evidenceRef:CODE};
function draft():PilotRegistrationDraft{
 const d=defaultPilotDraft();
 d.businessName='Pizzaria Americana';
 d.address={street:'Avenida dos Juritis',number:'146',district:'Bairro Validado',
  municipality:'Municipio de Teste',state:'SP',postalCode:'01001000'};
 d.contact={whatsappE164:'5511975691385',alternatePhoneE164:'5511998495454'};
 d.assistantName='Assistente da Pizzaria';
 d.schedule=Array.from({length:7},(_,day)=>({day,closed:day===1,
  open:day===1?'':'18:00',close:day===1?'':'23:00'}));
 d.menu={sourceRef:'owner-menu:revisao-validada-001',catalogVersion:1,
  pizzaFlavorCount:58,comboCount:5,halfHalfPricing:'MAX_FLAVOR',
  ingredientsReviewed:true,allergenEscalationAcknowledged:true};
 d.fulfillment={pickupEnabled:true,deliveryEnabled:true,
  postalFees:[{zoneId:'centro',fromCep:'01000000',toCep:'01099999',feeMinor:600}],
  prepMinutes:30,deliveryMinutes:35,pickupMinutes:10};
 d.preferredPaymentMethods=['PIX','CASH_ON_DELIVERY'];
 d.plannedStaffRoles=['OWNER','ATTENDANT','STAFF'];
 return d;
}
function catalog():UnitCatalogRevision{
 const flavors=Array.from({length:58},(_,i)=>({
  id:'flavor_'+(i+1),name:'Sabor '+(i+1),active:true,pricesBySize:{g:4000+i*10},
 }));
 const items:UnitCatalogRevision['items']=[{
  id:'pizza',kind:'PIZZA',name:'Pizza com sabores',active:true,
  pizza:{sizes:[{id:'g',name:'Grande',active:true}],flavors,borders:[],addons:[],
   maxFlavors:2,halfHalfPricing:'MAX_FLAVOR'},
 },{id:'esfiha',kind:'ITEM',name:'Esfiha',priceMinor:500,active:true},
  ...Array.from({length:5},(_,i)=>({id:'combo_'+i,name:'Combo '+i,kind:'COMBO' as const,
    active:true,priceMinor:3600+i*1000,components:[{itemId:'esfiha',quantity:3}]}))];
 return {tenantId:'pizza-a',unitId:'main',version:1,effectiveFrom:NOW,
  createdAt:NOW,createdBy:'owner_111',currency:'BRL',items,
  deliveryZones:[{id:'centro',name:'Centro',feeMinor:600,active:true}],
  promotions:[]};
}
class MemoryPilot implements PilotRegistrationRepository{
 data=new Map<string,PilotRegistrationRecord[]>();
 k(t:string,u:string){return JSON.stringify([t,u]);}
 async latest(t:string,u:string){
  const value=this.data.get(this.k(t,u))?.at(-1);
  return value?structuredClone(value):null;
 }
 async save(next:PilotRegistrationRecord,expectedVersion:number){
  const k=this.k(next.tenantId,next.unitId),old=this.data.get(k)??[];
  if(old.length!==expectedVersion||next.version!==old.length+1)
   throw Object.assign(new Error('Conflict'),{code:'PILOT_VERSION_CONFLICT'});
  this.data.set(k,[...old,structuredClone(next)]);return structuredClone(next);
 }
}
function setup(){
 const repo=new MemoryPilot();
 const state={profile:{
  tenantId:'pizza-a',unitId:'main',version:1,identity:{assistantName:'Assistente da Pizzaria'},
  capabilityRegistry:{vertical:'FOOD_SERVICE',operationMode:'NATIVE_OPERATIONS',
   capabilities:['FOOD_SERVICE','ORDERING','PRODUCTION','DELIVERY'],
   integrationStatus:'NOT_CONFIGURED'},
 } as BusinessProfileRevision, catalog:catalog()};
 const service=new PilotRegistrationService(repo,{
  latest:async(t,u)=>t==='pizza-a'&&u==='main'?state.profile:null,
  effective:async(t,u)=>t==='pizza-a'&&u==='main'&&
   (!state.profile.effectiveFrom||state.profile.effectiveFrom<='2026-11-21T18:00:00.000Z')?
   state.profile:null,
 },{
  latest:async(t,u)=>t==='pizza-a'&&u==='main'?state.catalog:null,
  effective:async(t,u)=>t==='pizza-a'&&u==='main'&&
   state.catalog.effectiveFrom<='2026-11-21T18:00:00.000Z'&&
   (!state.catalog.expiresAt||state.catalog.expiresAt>'2026-11-21T18:00:00.000Z')?
   state.catalog:null,
 },()=>new Date('2026-11-21T18:00:00.000Z'));
 return {repo,state,service};
}
async function draftAndMode(f=setup(),mode:'NATIVE_OPERATIONS'|'INTEGRATED_OPERATIONS'='NATIVE_OPERATIONS'){
 const saved=await f.service.saveDraft(t(),'main',{expectedVersion:0,data:draft()});
 await f.service.selectMode(t(),'main',{expectedVersion:saved.version,mode,
  reason:'Escolhido explicitamente pela proprietária após análise operacional',
  ...(mode==='INTEGRATED_OPERATIONS'?{externalSystemName:'PDV Cliente Teste'}:{})});
 return f;
}
describe('T08.1 — coleta, validação de proprietário e isolamento de cadastro real',()=>{
 it('starts NO_GO and never guesses a tenant, city, CEP, prices or mode',async()=>{
  const f=setup(),v=await f.service.get(t(),'main');
  expect(v.report).toMatchObject({status:'NO_GO',selectedMode:null,
   operationalActivationAllowed:false,nextGate:'T08.1_OWNER_VALIDATION'});
  expect(v.record).toBeNull();
  expect(v.blankDraft).toMatchObject({businessName:'',assistantName:'',menu:{
   catalogVersion:0,halfHalfPricing:null}});
 });
 it('does not allow STAFF, ADMIN or MANAGER to save, approve, choose or see owner private intake',async()=>{
  const f=setup();
  for(const role of ['STAFF','ADMIN','MANAGER','ATTENDANT','AI']){
   await expect(f.service.get(t('pizza-a',role),'main'))
    .rejects.toMatchObject({code:'PILOT_OWNER_REQUIRED'});
   await expect(f.service.saveDraft(t('pizza-a',role),'main',{expectedVersion:0,data:draft()}))
    .rejects.toMatchObject({code:'PILOT_OWNER_REQUIRED'});
  }
  expect(await f.repo.latest('pizza-a','main')).toBeNull();
 });
 it('rejects forged tenant, role, approval, status or mode fields in draft payload',async()=>{
  const f=setup(),value=draft();
  await expect(f.service.saveDraft(t(),'main',{expectedVersion:0,data:value,tenantId:'other'}))
   .rejects.toMatchObject({code:'PILOT_SAVE_FIELDS_INVALID'});
  await expect(f.service.saveDraft(t(),'main',{expectedVersion:0,
   data:{...value,modeDecision:{mode:'INTEGRATED_OPERATIONS'}}}))
   .rejects.toMatchObject({code:'PILOT_DRAFT_INVALID'});
  await expect(f.service.saveDraft(t(),'main',{expectedVersion:0,data:{
   ...value,mode:'INTEGRATED_OPERATIONS',status:'OWNER_ATTESTED'}}))
   .rejects.toMatchObject({code:'PILOT_DRAFT_INVALID'});
  expect(await f.repo.latest('pizza-b','main')).toBeNull();
 });
 it('requires proprietor-selected mode; setting choice does not alter T02/T06 runtime',async()=>{
  const f=setup();
  await f.service.saveDraft(t(),'main',{expectedVersion:0,data:draft()});
  await expect(f.service.attest(t(),'main',{...consent,expectedVersion:1}))
   .rejects.toMatchObject({code:'PILOT_OWNER_REVIEW_INCOMPLETE'});
  await expect(f.service.selectMode(t('pizza-a','MANAGER'),'main',{
   expectedVersion:1,mode:'INTEGRATED_OPERATIONS',reason:'Quero o PDV do cliente',
   externalSystemName:'System One'})).rejects.toMatchObject({code:'PILOT_OWNER_REQUIRED'});
  await expect(f.service.selectMode(t(),'main',{
   expectedVersion:1,mode:'INTEGRATED_OPERATIONS',
   reason:'Quero o PDV do cliente'})).rejects.toMatchObject({code:'PILOT_EXTERNAL_SYSTEM_REQUIRED'});
  const choice=await f.service.selectMode(t(),'main',{
   expectedVersion:1,mode:'INTEGRATED_OPERATIONS',
   reason:'A proprietária escolheu o PDV de modo explícito',
   externalSystemName:'PDV Cliente'});
  expect(choice).toMatchObject({status:'DRAFT',version:2,
   modeDecision:{mode:'INTEGRATED_OPERATIONS',externalSystemName:'PDV Cliente'}});
  expect(f.state.profile.capabilityRegistry.operationMode).toBe('NATIVE_OPERATIONS');
  expect((await f.service.get(t(),'main')).report).toMatchObject({
   status:'NO_GO',selectedMode:'INTEGRATED_OPERATIONS',operationalActivationAllowed:false});
 });
 it('reconciles catalog 58 recipes, 5 combos, fees, schedules, owner mode and final exact receipt',async()=>{
  const f=await draftAndMode();
  const before=await f.service.get(t(),'main');
  expect(before.report.status).toBe('NO_GO');
  expect(before.report.checks.filter(x=>x.status!=='READY').map(x=>x.code))
   .toEqual(['OWNER_SIGNOFF']);
  const approval=await f.service.attest(t(),'main',consent);
  expect(approval).toMatchObject({version:3,status:'OWNER_ATTESTED',
   attestation:{attestedBy:'owner_111',sourceVersion:2,profileVersion:1,catalogVersion:1}});
  const after=(await f.service.get(t(),'main')).report;
  expect(after).toMatchObject({status:'OWNER_ATTESTED',selectedMode:'NATIVE_OPERATIONS',
   nextGate:'T08.2_REQUIRES_SEPARATE_AUTHORIZATION',operationalActivationAllowed:false});
  expect(after.checks.every(x=>x.status==='READY')).toBe(true);
  expect(f.repo.data.get(f.repo.k('pizza-a','main'))).toHaveLength(3);
 });
 it('blocks unverified owner evidence, replay, wrong version and cross-tenant read',async()=>{
  const f=await draftAndMode();
  await expect(f.service.attest(t(),'main',{...consent,statement:'CONFIRMADO'}))
   .rejects.toMatchObject({code:'PILOT_ATTESTATION_STATEMENT_REQUIRED'});
  await expect(f.service.attest(t(),'main',{...consent,evidenceRef:'I SAID YES'}))
   .rejects.toMatchObject({code:'PILOT_OWNER_EVIDENCE_REFERENCE_REQUIRED'});
  await expect(f.service.attest(t(),'main',{...consent,expectedVersion:1}))
   .rejects.toMatchObject({code:'PILOT_VERSION_CONFLICT'});
  expect((await f.service.get(t('pizza-b'),'main')).record).toBeNull();
 });
 it('refuses proprietor approval of scheduled-future or expired catalog and business revisions',async()=>{
  const f=await draftAndMode();
  f.state.catalog={...f.state.catalog,effectiveFrom:'2027-01-01T00:00:00.000Z'};
  expect((await f.service.get(t(),'main')).report.checks.find(x=>
   x.code==='EFFECTIVE_CATALOG_REVISION')?.status).toBe('CONFLICT');
  await expect(f.service.attest(t(),'main',consent))
   .rejects.toMatchObject({code:'PILOT_OWNER_REVIEW_INCOMPLETE'});
  f.state.catalog={...f.state.catalog,effectiveFrom:NOW};
  f.state.profile={...f.state.profile,effectiveFrom:'2027-01-01T00:00:00.000Z'};
  expect((await f.service.get(t(),'main')).report.checks.find(x=>
   x.code==='EFFECTIVE_PROFILE_REVISION')?.status).toBe('CONFLICT');
 });

 it('invalidates approval immediately if canonical catalog price, revision or profile changes',async()=>{
  const f=await draftAndMode();
  await f.service.attest(t(),'main',consent);
  f.state.catalog={...f.state.catalog,version:2};
  expect((await f.service.get(t(),'main')).report.status).toBe('NO_GO');
  f.state.catalog={...f.state.catalog,version:1};
  f.state.profile={...f.state.profile,identity:{...f.state.profile.identity,
   assistantName:'Nome Alterado'}};
  expect((await f.service.get(t(),'main')).report.status).toBe('NO_GO');
 });
 it('fails closed on missing pizza prices, 58 flavors mismatch, mode mismatch and delivery fee drift',async()=>{
  const f=await draftAndMode();
  f.state.catalog.items[0].pizza!.flavors[0].pricesBySize.g=0;
  let report=(await f.service.get(t(),'main')).report;
  expect(report.checks.find(x=>x.code==='CATALOG_PRICES_COMPLETE')?.status).toBe('CONFLICT');
  f.state.catalog.items[0].pizza!.flavors.pop();
  report=(await f.service.get(t(),'main')).report;
  expect(report.checks.find(x=>x.code==='PIZZA_AND_COMBO_COUNTS')?.status).toBe('CONFLICT');
  f.state.catalog.deliveryZones[0].feeMinor=700;
  report=(await f.service.get(t(),'main')).report;
  expect(report.checks.find(x=>x.code==='ZONE_FEES_MATCH_CATALOG')?.status).toBe('CONFLICT');
  await expect(f.service.attest(t(),'main',consent))
   .rejects.toMatchObject({code:'PILOT_OWNER_REVIEW_INCOMPLETE'});
 });
 it('resets attestation and requires new approval when any owner-reviewed field changes',async()=>{
  const f=await draftAndMode();
  await f.service.attest(t(),'main',consent);
  const changed=draft();changed.assistantName='Novo nome autorizado';
  const saved=await f.service.saveDraft(t(),'main',{expectedVersion:3,data:changed});
  expect(saved.status).toBe('DRAFT');
  expect(saved.attestation).toBeUndefined();
  expect((await f.service.get(t(),'main')).report.status).toBe('NO_GO');
 });
 it('accepts 58 pizza flavors on a single T03 pizza SKU without artificial 40-flavor ceiling',async()=>{
  const catalogInput58=catalogInput();
  catalogInput58.items[0].pizza!.flavors=Array.from({length:58},(_,i)=>({
   id:'sabor'+i,name:'Sabor '+i,active:true,pricesBySize:{g:4500+i,p:3500+i}}));
  const storage=new InMemoryCatalog();
  const result=await new UnitCatalogService(storage,t03Profiles,()=>new Date(NOW))
   .publish(t03Ctx(),'main',catalogInput58);
  expect(result.items[0].pizza?.flavors).toHaveLength(58);
  expect(result.items[0].pizza?.maxFlavors).toBe(2);
 });
 it('keeps merchant configuration generic without embedding a customer identity in the application',async()=>{
  const f=setup();
  const form=draft();
  form.vertical='RETAIL';
  form.businessName='Comércio Exemplo';
  form.contact.whatsappE164='5511988881111';
  form.address.municipality='Município Exemplo';
  const saved=await f.service.saveDraft(t(),'main',{expectedVersion:0,data:form});
  expect(saved.data).toMatchObject({vertical:'RETAIL',businessName:'Comércio Exemplo',
   contact:{whatsappE164:'5511988881111'},address:{municipality:'Município Exemplo'}});
  const view=await f.service.get(t(),'main');
  expect(view.report.checks.find(x=>x.code==='PILOT_FOOD_SERVICE_VERTICAL')?.status)
   .toBe('MISSING');
  expect(view.report.operationalActivationAllowed).toBe(false);
 });
 it('exposes protected owner-only HTTP routes with data & mode tampering blocked',async()=>{
  const f=setup(),app=express();app.use(express.json());
  app.use('/pilot',(req,_res,next)=>{
   const role=req.header('x-test-role')??'OWNER';
   if(req.header('x-test-unauth')!=='1')
    req.tenantContext=t(req.header('x-test-tenant')??'pizza-a',role);
   next();
  },createPilotOnboardingRouter(f.service));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+
    '/pilot/units/main/onboarding';
   const unauth=await fetch(url,{headers:{'x-test-unauth':'1'}});
   expect(unauth.status).toBe(403);
   const admin=await fetch(url,{headers:{'x-test-role':'ADMIN'}});
   expect(admin.status).toBe(403);
   const save=await fetch(url+'/draft',{method:'PUT',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedVersion:0,data:draft()})});
   expect(save.status).toBe(200);
   const cross=await fetch(url,{headers:{'x-test-tenant':'pizza-b'}});
   expect((await cross.json()).data.record).toBeNull();
   const response=await fetch(url);expect((await response.json()).data.record.version).toBe(1);
   const bad=await fetch(url+'/mode',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedVersion:1,mode:'INTEGRATED_OPERATIONS',
     reason:'Testar outro sistema',connectorId:'FAKE'})});
   expect(bad.status).toBe(400);
  }finally{await new Promise<void>(done=>server.close(()=>done()));}
 });
});
