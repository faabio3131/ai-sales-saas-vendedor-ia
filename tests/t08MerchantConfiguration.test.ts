import {describe,it,expect} from 'vitest';
import express from 'express';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import type {TenantContext} from '../src/types/contracts';
import type {PilotRegistrationRecord,PilotRegistrationRepository} from '../src/pilot/onboarding/model';
import {defaultPilotDraft} from '../src/pilot/onboarding/validation';
import {PilotRegistrationService} from '../src/pilot/onboarding/service';
import {createEstablishmentSettingsRouter} from '../src/establishments/routes';
import {createPilotOnboardingRouter} from '../src/pilot/onboarding/routes';
import {errorHandler} from '../src/api/middleware/errorHandler';

const ctx=(tenantId:string,role='OWNER'):TenantContext=>({tenantId,role,userId:'member-'+tenantId,requestId:'merchant-request'});
class MemoryMerchantRepository implements PilotRegistrationRepository{
 private readonly records=new Map<string,PilotRegistrationRecord[]>();
 private key(t:string,u:string){return JSON.stringify([t,u]);}
 async latest(t:string,u:string){return structuredClone(this.records.get(this.key(t,u))?.at(-1)??null);}
 async save(next:PilotRegistrationRecord,expectedVersion:number){
  const key=this.key(next.tenantId,next.unitId),prior=this.records.get(key)??[];
  if(prior.length!==expectedVersion)throw Object.assign(new Error('revision conflict'),{code:'PILOT_VERSION_CONFLICT'});
  this.records.set(key,[...prior,structuredClone(next)]);return structuredClone(next);
 }
}
function configure() {
 const repository=new MemoryMerchantRepository();
 const profiles={effective:async()=>null,latest:async()=>null};
 const catalog={effective:async()=>null,latest:async()=>null};
 return {repository,service:new PilotRegistrationService(repository,profiles,catalog)};
}
function data(name:string,vertical:'FOOD_SERVICE'|'RETAIL'|'SERVICES'='FOOD_SERVICE'){
 const d=defaultPilotDraft();
 d.vertical=vertical;d.businessName=name;
 d.address={street:'Rua do Comércio',number:'44',district:'Centro',
  municipality:'Cidade Teste',state:'SP',postalCode:'12345678'};
 d.contact={whatsappE164:'5511999990000',alternatePhoneE164:''};
 d.assistantName='Atendente '+name;
 return d;
}
describe('Multi-tenant configurable establishment settings independent of the T08 pilot',()=>{
 it('writes independent company addresses, telephones and assistant names by tenant AND unit',async()=>{
  const {service}=configure();
  await service.saveDraft(ctx('tenant-a'),'store-1',{expectedVersion:0,data:data('Loja A','RETAIL')});
  await service.saveDraft(ctx('tenant-b'),'store-1',{expectedVersion:0,data:data('Loja B','SERVICES')});
  await service.saveDraft(ctx('tenant-a'),'store-2',{expectedVersion:0,data:data('Loja A filial','RETAIL')});
  const a=(await service.get(ctx('tenant-a'),'store-1')).record;
  const b=(await service.get(ctx('tenant-b'),'store-1')).record;
  const filial=(await service.get(ctx('tenant-a'),'store-2')).record;
  expect(a?.data).toMatchObject({vertical:'RETAIL',businessName:'Loja A',address:{municipality:'Cidade Teste'},
   contact:{whatsappE164:'5511999990000'},assistantName:'Atendente Loja A'});
  expect(b?.data.businessName).toBe('Loja B');
  expect(filial?.data.businessName).toBe('Loja A filial');
  expect(await service.get(ctx('tenant-c'),'store-1')).toMatchObject({record:null,report:{status:'NO_GO'}});
  expect((await service.get(ctx('tenant-b'),'store-2')).record).toBeNull();
 });
 it('can save incomplete drafts for any vertical without real owner approval and without activating external systems',async()=>{
  const {service}=configure();
  const form=defaultPilotDraft();form.vertical='BEAUTY';form.businessName='Espaço Estilo';
  await service.saveDraft(ctx('tenant-x'),'main',{expectedVersion:0,data:form});
  const result=await service.get(ctx('tenant-x'),'main');
  expect(result.record?.data).toMatchObject({businessName:'Espaço Estilo',vertical:'BEAUTY'});
  expect(result.report).toMatchObject({status:'NO_GO',operationalActivationAllowed:false});
  expect(result.report.checks.find(x=>x.code==='PILOT_FOOD_SERVICE_VERTICAL')?.status).toBe('MISSING');
  expect(result.record?.attestation).toBeUndefined();
 });
 it('never permits employee/admin or role spoofing to change company settings',async()=>{
  const {service}=configure();
  for(const role of ['STAFF','ATTENDANT','ADMIN','MANAGER']){
   await expect(service.get(ctx('tenant-a',role),'main'))
    .rejects.toMatchObject({code:'PILOT_OWNER_REQUIRED'});
   await expect(service.saveDraft(ctx('tenant-a',role),'main',
    {expectedVersion:0,data:data('Pizzaria de teste')}))
    .rejects.toMatchObject({code:'PILOT_OWNER_REQUIRED'});
  }
  expect((await service.get(ctx('tenant-a'),'main')).record).toBeNull();
 });
 it('preserves one canonical record through generic and legacy routes; rejects other tenants and tampered mode',async()=>{
  const {service}=configure();
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{if(req.header('x-unauth')!=='yes')
   req.tenantContext=ctx(req.header('x-test-tenant')??'tenant-a',req.header('x-test-role')??'OWNER');
   next();});
  app.use('/establishments',createEstablishmentSettingsRouter(service));
  app.use('/pilot',createPilotOnboardingRouter(service));
  app.use(errorHandler);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  try{
   const url=base+'/establishments/units/store-1/configuration';
   const unauthorized=await fetch(url,{headers:{'x-unauth':'yes'}});
   expect(unauthorized.status).toBe(403);
   const staff=await fetch(url,{headers:{'x-test-role':'STAFF'}});
   expect(staff.status).toBe(403);
   const created=await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedVersion:0,data:data('Loja Genérica','RETAIL')})});
   expect(created.status).toBe(200);
   const recorded=await fetch(base+'/pilot/units/store-1/onboarding');
   expect((await recorded.json()).data.record.data.businessName).toBe('Loja Genérica');
   const other=await fetch(url,{headers:{'x-test-tenant':'tenant-b'}});
   expect((await other.json()).data.record).toBeNull();
   const tampered=await fetch(base+'/establishments/units/store-1/operation-mode',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedVersion:1,mode:'INTEGRATED_OPERATIONS',
     reason:'Conectar ao sistema atual',externalSystemName:'PDV Cliente',tenantId:'tenant-b'})});
   expect(tampered.status).toBe(400);
   const selected=await fetch(base+'/establishments/units/store-1/operation-mode',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedVersion:1,mode:'NATIVE_OPERATIONS',
     reason:'Equipe usa painel próprio do SaaS'})});
   expect(selected.status).toBe(200);
   const result=await fetch(url);
   const view=(await result.json()).data;
   expect(view.record).toMatchObject({version:2,status:'DRAFT',
    modeDecision:{mode:'NATIVE_OPERATIONS'},data:{businessName:'Loja Genérica'}});
   expect(view.report).toMatchObject({status:'NO_GO',operationalActivationAllowed:false});
  }finally{await new Promise<void>(done=>server.close(()=>done()));}
 });
});
