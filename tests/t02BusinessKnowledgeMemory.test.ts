import { describe,expect,it,vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { errorHandler } from '../src/api/middleware/errorHandler';
import { createBusinessRouter } from '../src/business/routes';
import { purgeExpiredBusinessMemories } from '../scripts/purgeExpiredBusinessMemories';
import type { BusinessProfileRepository,ScopedMemoryRepository } from '../src/business/contracts';
import type { BusinessProfileInput,BusinessProfileRevision } from '../src/business/model';
import type { ScopedCustomerMemory } from '../src/business/memoryModel';
import { BusinessProfileService } from '../src/business/service';
import { BusinessGroundingService } from '../src/business/grounding';
import { BusinessMemoryService,type MemorySourceVerifier } from '../src/business/memoryService';
import { CommercialCustomerContextService } from '../src/business/customerContext';
import { ConversationMemorySourceVerifier } from '../src/business/consentVerifier';
import { buildCognitiveContextPack } from '../src/ai/cognitiveContext';
import type { CatalogRepository } from '../src/catalog/contracts';
import type { CatalogItem } from '../src/catalog/model';
import type { CustomerRepository } from '../src/customers/contracts';
import type { Customer,ExternalIdentity } from '../src/customers/model';
import type { ConversationRepository,MessageRepository } from '../src/conversations/contracts';
import type { Conversation,Message } from '../src/conversations/model';
import type { TenantContext } from '../src/types/contracts';

const t=(tenantId:string,role='OWNER'):TenantContext=>({
  tenantId,role,userId:'verified-user-'+tenantId,requestId:'request-'+tenantId,
});
const NOW='2026-11-21T12:00:00.000Z';
const LATER='2026-11-22T12:00:00.000Z';
function profileInput(opts:Partial<BusinessProfileInput>={}):BusinessProfileInput{
  return {
    expectedVersion:0,effectiveFrom:'2026-11-20T00:00:00.000Z',
    identity:{assistantName:'Atendente Pizzaria',voiceStyle:'FRIENDLY'},
    capabilityRegistry:{
      vertical:'FOOD_SERVICE',
      capabilities:['FOOD_SERVICE','ORDERING','PRODUCTION','DELIVERY'],
      operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED',
    },
    policy:{
      locale:'pt-BR',timezone:'America/Sao_Paulo',
      memoryRetentionDays:30,personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true,
    },
    facts:[
      {id:'hours',kind:'HOURS',question:'Qual o horário?',answer:'Atendemos de terça a domingo.',sourceRef:'manager:hours-v1'},
      {id:'delivery',kind:'DELIVERY',question:'Faz delivery?',answer:'Sim, dentro da área cadastrada.',sourceRef:'manager:delivery-v1'},
    ],
    ...opts,
  };
}
class ProfilesMemory implements BusinessProfileRepository {
  private readonly records=new Map<string,BusinessProfileRevision[]>();
  private id(t:string,u:string){return JSON.stringify([t,u]);}
  async latest(t:string,u:string){return this.records.get(this.id(t,u))?.at(-1)??null;}
  async effective(t:string,u:string,at:string){
    const candidate=(this.records.get(this.id(t,u))??[]).filter(x=>x.effectiveFrom<=at).at(-1);
    return candidate && (!candidate.expiresAt||candidate.expiresAt>at)?candidate:null;
  }
  async createRevision(profile:BusinessProfileRevision,expected:number){
    const key=this.id(profile.tenantId,profile.unitId);
    const records=this.records.get(key)??[];
    if(records.length!==expected||profile.version!==expected+1)throw Object.assign(new Error('conflict'),{code:'BUSINESS_VERSION_CONFLICT'});
    this.records.set(key,[...records,structuredClone(profile)]);
  }
}
class MemoriesMemory implements ScopedMemoryRepository {
  private readonly records=new Map<string,ScopedCustomerMemory>();
  private key(t:string,u:string,c:string){return JSON.stringify([t,u,c]);}
  async get(t:string,u:string,c:string){return this.records.get(this.key(t,u,c))??null;}
  async save(r:ScopedCustomerMemory,expected:number){
    const k=this.key(r.tenantId,r.unitId,r.customerId);
    if((this.records.get(k)?.version??0)!==expected)throw Object.assign(new Error('conflict'),{code:'MEMORY_VERSION_CONFLICT'});
    this.records.set(k,structuredClone(r));
  }
  async delete(t:string,u:string,c:string,expected:number){
    const key=this.key(t,u,c);
    if((this.records.get(key)?.version??0)!==expected)throw Object.assign(new Error('conflict'),{code:'MEMORY_VERSION_CONFLICT'});
    this.records.delete(key);
  }
  async purgeExpired(at:string){let count=0;for(const [key,record] of this.records){if(record.expiresAt<=at){this.records.delete(key);count++;}}return count;}
}
class CatalogMemory implements CatalogRepository {
  constructor(public items:CatalogItem[]){}
  async listByTenant(t:string){return this.items.filter(x=>x.tenantId===t);}
  async findById(t:string,id:string){return this.items.find(x=>x.tenantId===t&&x.id===id)??null;}
  async create(item:CatalogItem){this.items.push(item);return item;}
  async update(item:CatalogItem){return item;}
}
class CustomerMemory implements CustomerRepository {
  constructor(private readonly records:Customer[]){}
  async listByTenant(t:string){return this.records.filter(x=>x.tenantId===t);}
  async findById(t:string,id:string){return this.records.find(x=>x.tenantId===t&&x.id===id)??null;}
  async findByExternalIdentity(_t:string,_id:ExternalIdentity){return null;}
  async create(customer:Customer){this.records.push(customer);return customer;}
  async update(customer:Customer){return customer;}
}
const item=(id:string,tenantId:string,name:string,priceMinor:number,active=true):CatalogItem=>({
  id,tenantId,name,priceMinor,type:'PRODUCT',active,currency:'BRL',
  createdAt:NOW,updatedAt:NOW,
});
const customer=(id:string,tenantId:string):Customer=>({
  id,tenantId,name:'Cliente',externalIdentities:[],status:'ACTIVE',
  createdAt:NOW,updatedAt:NOW,
});
class VerifiedSources implements MemorySourceVerifier {
  async verifyCustomerEvidence(t:string,c:string,ref:string){return ref==='conversation:'+t+':'+c+':evidence';}
  async verifyExplicitConsent(t:string,c:string,ref:string){return ref==='conversation:'+t+':'+c+':consent';}
}
async function setup(){
  const profiles=new ProfilesMemory();
  const manager=new BusinessProfileService(profiles);
  await manager.publish(t('pizza-a'),'unit-1',profileInput());
  await manager.publish(t('pizza-b'),'unit-2',profileInput({
    identity:{assistantName:'Assistente Estação',voiceStyle:'PROFESSIONAL'},
    capabilityRegistry:{
      vertical:'FOOD_SERVICE',capabilities:['FOOD_SERVICE','ORDERING'],
      operationMode:'INTEGRATED_OPERATIONS',integrationStatus:'NOT_CONFIGURED',
    },
    facts:[{id:'hours',kind:'HOURS',question:'Qual o horário?',answer:'Funcionamos somente aos sábados.',sourceRef:'manager:b-1'}],
  }));
  return {profiles,manager};
}
describe('T02 — Business Knowledge, PolicyProfile and horizontal capabilities',()=>{
  it('separates two tenants with different hours, catalog amounts and operation modes',async()=>{
    const {profiles,manager}=await setup();
    const g=new BusinessGroundingService(profiles,new CatalogMemory([
      item('a','pizza-a','Pizza Grande',5990),item('b','pizza-b','Pizza Grande',6990),
    ]));
    const a=await g.answer(t('pizza-a'),'unit-1','Qual o horário?',NOW);
    const b=await g.answer(t('pizza-b'),'unit-2','Qual o horário?',NOW);
    expect(a).toMatchObject({status:'ANSWERED',answer:'Atendemos de terça a domingo.',profileVersion:1});
    expect(b).toMatchObject({status:'ANSWERED',answer:'Funcionamos somente aos sábados.'});
    expect(await g.answer(t('pizza-a'),'unit-1','Quanto custa Pizza Grande?',NOW))
      .toMatchObject({status:'ANSWERED',answer:'Pizza Grande: R$ 59,90',evidenceIds:['catalog:a']});
    expect(await g.answer(t('pizza-b'),'unit-2','Quanto custa Pizza Grande?',NOW))
      .toMatchObject({status:'ANSWERED',answer:'Pizza Grande: R$ 69,90',evidenceIds:['catalog:b']});
    const aa=await manager.latest(t('pizza-a'),'unit-1');
    const bb=await manager.latest(t('pizza-b'),'unit-2');
    expect(aa?.capabilityRegistry.operationMode).toBe('NATIVE_OPERATIONS');
    expect(bb?.capabilityRegistry.operationMode).toBe('INTEGRATED_OPERATIONS');
    expect(bb?.identity.assistantName).toBe('Assistente Estação');
    expect(await g.answer(t('pizza-a'),'unit-2','Qual o horário?',NOW)).toMatchObject({status:'UNKNOWN'});
  });
  it('keeps old revisions immutable, scheduled policy effective only at the configured instant',async()=>{
    const {manager}=await setup();
    await manager.publish(t('pizza-a'),'unit-1',profileInput({
      expectedVersion:1,effectiveFrom:'2026-11-22T00:00:00.000Z',
      identity:{assistantName:'Nova Atendente',voiceStyle:'DIRECT'},
      facts:[{id:'hours',kind:'HOURS',question:'Qual o horário?',answer:'Aberto aos domingos.',sourceRef:'manager:new'}],
    }));
    expect((await manager.effective(t('pizza-a'),'unit-1',NOW))?.identity.assistantName).toBe('Atendente Pizzaria');
    expect((await manager.effective(t('pizza-a'),'unit-1',LATER))?.identity.assistantName).toBe('Nova Atendente');
    expect((await manager.latest(t('pizza-a'),'unit-1'))?.version).toBe(2);
    await expect(manager.publish(t('pizza-a'),'unit-1',profileInput({expectedVersion:1,effectiveFrom:LATER})))
      .rejects.toMatchObject({code:'BUSINESS_VERSION_CONFLICT'});
    await expect(manager.publish(t('pizza-a'),'unit-1',profileInput({
      expectedVersion:2,effectiveFrom:'2026-11-21T00:00:00.000Z',
    }))).rejects.toMatchObject({code:'BUSINESS_EFFECTIVE_PERIOD_INVALID'});
  });
  it('does not revive old rules after the newer revision expires',async()=>{
    const {manager}=await setup();
    await manager.publish(t('pizza-a'),'unit-1',profileInput({
      expectedVersion:1,effectiveFrom:'2026-11-22T00:00:00.000Z',expiresAt:'2026-11-23T00:00:00.000Z',
    }));
    expect(await manager.effective(t('pizza-a'),'unit-1','2026-11-24T00:00:00.000Z')).toBeNull();
  });
  it('rejects contradictory facts, invented monetary policy, wrong timezone and unsupported capability',async()=>{
    const p=new BusinessProfileService(new ProfilesMemory());
    await expect(p.publish(t('a'),'main',profileInput({facts:[
      {id:'x',kind:'FAQ',question:'Qual o horário?',answer:'Abre cedo.',sourceRef:'ref-1'},
      {id:'y',kind:'FAQ',question:'qual o horario',answer:'Abre tarde.',sourceRef:'ref-2'},
    ]}))).rejects.toMatchObject({code:'BUSINESS_FACT_CONTRADICTION'});
    await expect(p.publish(t('a'),'main',profileInput({facts:[
      {id:'x',kind:'FAQ',question:'Quanto custa?',answer:'O total é R$ 1,00.',sourceRef:'ref-1'},
    ]}))).rejects.toMatchObject({code:'BUSINESS_MONETARY_FACT_FORBIDDEN'});
    await expect(p.publish(t('a'),'main',profileInput({policy:{
      ...profileInput().policy,timezone:'Invalid/Zone',
    }}))).rejects.toMatchObject({code:'BUSINESS_TIMEZONE_INVALID'});
    await expect(p.publish(t('a'),'main',profileInput({capabilityRegistry:{
      ...profileInput().capabilityRegistry,capabilities:['SCHEDULING'] as never,
    }}))).rejects.toMatchObject({code:'BUSINESS_CAPABILITIES_INVALID'});
  });
  it('rejects guests and viewers trying to publish or read latest configuration',async()=>{
    const {manager}=await setup();
    await expect(manager.latest(t('pizza-a','VIEWER'),'unit-1'))
      .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
    await expect(manager.publish(t('pizza-a','VIEWER'),'unit-1',profileInput()))
      .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
    await expect(manager.publish({...t('pizza-a'),userId:undefined},'unit-1',profileInput()))
      .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
  });
  it('prevents unsupported or absent operational capability from being treated as configured integration',async()=>{
    const {manager}=await setup();
    const p=(await manager.latest(t('pizza-b'),'unit-2'))!;
    expect(p.capabilityRegistry.operationMode).toBe('INTEGRATED_OPERATIONS');
    expect(p.capabilityRegistry.integrationStatus).toBe('NOT_CONFIGURED');
    expect(p.capabilityRegistry.capabilities).not.toContain('PRODUCTION');
  });
  it('keeps prices sourced only from active catalog and returns UNKNOWN for missing facts',async()=>{
    const {profiles}=await setup();
    const g=new BusinessGroundingService(profiles,new CatalogMemory([
      item('a','pizza-a','Pizza Portuguesa',4500,false),item('b','pizza-a','Pizza Marguerita',0),
    ]));
    expect((await g.answer(t('pizza-a'),'unit-1','Quanto custa Pizza Portuguesa?',NOW)).status).toBe('UNKNOWN');
    expect((await g.answer(t('pizza-a'),'unit-1','Quanto custa Pizza Marguerita?',NOW)).answer).toContain('R$ 0,00');
    expect(await g.answer(t('pizza-a'),'unit-1','Qual a promoção?',NOW)).toMatchObject({status:'UNKNOWN'});
    expect(await g.answer(t('pizza-a'),'unit-1','Qual o preço do delivery?',NOW)).toMatchObject({status:'UNKNOWN'});
  });
  it('returns conflict instead of guessing when multiple catalog products match one question',async()=>{
    const {profiles}=await setup();
    const g=new BusinessGroundingService(profiles,new CatalogMemory([
      item('a','pizza-a','Pizza Grande',4590),item('b','pizza-a','Pizza',3490),
    ]));
    expect(await g.answer(t('pizza-a'),'unit-1','Quanto custa Pizza Grande?',NOW))
      .toMatchObject({status:'CONFLICT',source:'NONE'});
  });
  it('constructs provenance-ready T01 context only from active scoped approved facts',async()=>{
    const {profiles}=await setup();
    const g=new BusinessGroundingService(profiles,new CatalogMemory([
      item('a','pizza-a','Pizza Grande',4590),item('b','pizza-b','Pizza Grande',3490),
    ]));
    const request=await g.groundedAIRequest(t('pizza-a'),'unit-1',{stage:'QUALIFICADO'},NOW);
    const pack=buildCognitiveContextPack(request);
    expect(pack.scopeTenantId).toBe('pizza-a');
    expect(pack.evidenceIds).toContain('business:unit-1:1:hours');
    expect(pack.evidenceIds).toContain('catalog:a');
    expect(pack.evidenceIds).not.toContain('catalog:b');
    expect(pack.trustedFacts).not.toContain('34,90');
  });
});
describe('T02 — Governed, provenanced customer memory',()=>{
  async function memoryEnvironment(){
    const {profiles}=await setup();
    const memories=new MemoriesMemory();
    let now=NOW;
    const customers=new CustomerMemory([customer('cust-a','pizza-a'),customer('cust-b','pizza-b')]);
    const service=new BusinessMemoryService(customers,profiles,memories,new VerifiedSources(),()=>new Date(now));
    return {service,memories,profiles,setNow:(value:string)=>{now=value;}};
  }
  it('denies personalized memory without verified explicit consent',async()=>{
    const {service}=await memoryEnvironment();
    expect(await service.get(t('pizza-a'),'unit-1','cust-a')).toBeNull();
    await expect(service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,summary:'Gosta de pizza.',sourceRefs:['conversation:pizza-a:cust-a:evidence'],
    })).rejects.toMatchObject({code:'MEMORY_CONSENT_REQUIRED'});
    await expect(service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-b:consent',
    })).rejects.toMatchObject({code:'MEMORY_CONSENT_EVIDENCE_UNVERIFIED'});
  });
  it('stores and retrieves tenant- and unit-specific memories only with verified provenance',async()=>{
    const {service}=await memoryEnvironment();
    const consent=await service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-a:consent',
    });
    expect(consent).toMatchObject({version:1,status:'GRANTED',summary:''});
    const memory=await service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:1,summary:'Prefere pizza de queijo.',interests:['pizza','pizza'],
      preferences:['sem cebola'],sourceRefs:['conversation:pizza-a:cust-a:evidence'],
    });
    expect(memory.version).toBe(2);
    expect(memory.interests).toEqual(['pizza']);
    expect((await service.get(t('pizza-a'),'unit-1','cust-a'))?.summary).toContain('queijo');
    await expect(service.get(t('pizza-b'),'unit-2','cust-a')).rejects.toMatchObject({code:'CUSTOMER_NOT_FOUND'});
    await expect(service.get(t('pizza-a'),'unit-2','cust-a')).rejects.toMatchObject({code:'MEMORY_POLICY_NOT_ACTIVE'});
  });
  it('revokes consent with immediate logical erasure and forbids reuse of previous version',async()=>{
    const {service}=await memoryEnvironment();
    await service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-a:consent',
    });
    await service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:1,summary:'Mensagem pessoal.',sourceRefs:['conversation:pizza-a:cust-a:evidence'],
    });
    const revoked=await service.changeConsent(t('pizza-a'),'unit-1','cust-a',{expectedVersion:2,grant:false});
    expect(revoked).toMatchObject({version:3,status:'REVOKED',summary:'',interests:[],preferences:[]});
    expect(await service.get(t('pizza-a'),'unit-1','cust-a')).toBeNull();
    await expect(service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:2,summary:'Must not be stored',sourceRefs:['conversation:pizza-a:cust-a:evidence'],
    })).rejects.toMatchObject({code:'MEMORY_CONSENT_REQUIRED'});
    await service.forget(t('pizza-a'),'unit-1','cust-a',3);
  });
  it('enforces retention, automatic expiry invisibility and physical purge capability',async()=>{
    const {service,memories,setNow}=await memoryEnvironment();
    await service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-a:consent',
    });
    await service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:1,summary:'Preferências.',sourceRefs:['conversation:pizza-a:cust-a:evidence'],
    });
    setNow('2027-01-01T00:00:00.000Z');
    expect(await service.get(t('pizza-a'),'unit-1','cust-a')).toBeNull();
    expect(await memories.purgeExpired('2027-01-01T00:00:00.000Z')).toBe(1);
    expect(await memories.get('pizza-a','unit-1','cust-a')).toBeNull();
  });
  it('does not leak sensitive fields into memory and refuses unproven statements',async()=>{
    const {service}=await memoryEnvironment();
    await service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-a:consent',
    });
    await expect(service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:1,summary:'pessoa',sourceRefs:['fake:no-provenance'],
    })).rejects.toMatchObject({code:'MEMORY_SOURCE_UNVERIFIED'});
    const result=await service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:1,summary:'Email cliente@example.com; cartão 4111 1111 1111 1111',
      sourceRefs:['conversation:pizza-a:cust-a:evidence'],
    });
    expect(result.summary).not.toContain('cliente@example.com');
    expect(result.summary).not.toContain('4111 1111 1111 1111');
  });
  it('denies viewer role and concurrent stale writes',async()=>{
    const {service}=await memoryEnvironment();
    await expect(service.changeConsent(t('pizza-a','VIEWER'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-a:consent',
    })).rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
    await service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-a:consent',
    });
    await expect(service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:false,
    })).rejects.toMatchObject({code:'MEMORY_VERSION_CONFLICT'});
  });
  it('assembles approved facts with memory only after explicit consent and expires it safely',async()=>{
    const {service,profiles,setNow}=await memoryEnvironment();
    const grounding=new BusinessGroundingService(profiles,new CatalogMemory([
      item('one','pizza-a','Pizza Portuguesa',4500),
    ]));
    const assembler=new CommercialCustomerContextService(grounding,service);
    const empty=await assembler.aiRequest(t('pizza-a'),'unit-1','cust-a',{stage:'NOVO'},NOW);
    expect(buildCognitiveContextPack(empty).untrustedData).not.toContain('customerMemory');
    await service.changeConsent(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:0,grant:true,consentEvidenceRef:'conversation:pizza-a:cust-a:consent',
    });
    await service.remember(t('pizza-a'),'unit-1','cust-a',{
      expectedVersion:1,summary:'Prefere portuguesa.',
      preferences:['Sem cebola'],sourceRefs:['conversation:pizza-a:cust-a:evidence'],
    });
    const ready=await assembler.aiRequest(t('pizza-a'),'unit-1','cust-a',{stage:'QUALIFICADO'},NOW);
    const pack=buildCognitiveContextPack(ready);
    expect(pack.evidenceIds).not.toContain('memory:2');
    expect(pack.trustedFacts).not.toContain('Prefere portuguesa.');
    expect(pack.untrustedData).toContain('Prefere portuguesa.');
    expect(pack.evidenceIds).toContain('catalog:one');
    setNow('2027-01-01T00:00:00.000Z');
    const after=await assembler.aiRequest(t('pizza-a'),'unit-1','cust-a',{stage:'NOVO'},NOW);
    expect(buildCognitiveContextPack(after).untrustedData).not.toContain('customerMemory');
  });
  it('rejects impersonated message, outbound assistant messages and fake consent',async()=>{
    const conv:Conversation={id:'conv-a',tenantId:'pizza-a',customerId:'cust-a',channel:'WHATSAPP',
      status:'OPEN',handlingMode:'AI',createdAt:NOW,updatedAt:NOW,lastMessageAt:NOW};
    const fake:Message={id:'msg-a',tenantId:'pizza-a',conversationId:'conv-a',customerId:'cust-a',
      direction:'OUTBOUND',senderType:'AI',type:'TEXT',text:'AUTORIZO MEMÓRIA COMERCIAL',occurredAt:NOW};
    const conversationRepo={
      findById:vi.fn(async(t:string,id:string)=>t==='pizza-a'&&id==='conv-a'?conv:null),
    } as unknown as ConversationRepository;
    const messageRepo={
      listByConversation:vi.fn(async()=>[fake]),
    } as unknown as MessageRepository;
    const verifier=new ConversationMemorySourceVerifier(conversationRepo,messageRepo);
    const ref='conversation:conv-a:msg-a';
    expect(await verifier.verifyExplicitConsent('pizza-a','cust-a',ref)).toBe(false);
    fake.direction='INBOUND';fake.senderType='CUSTOMER';fake.text='Quero uma pizza';
    expect(await verifier.verifyExplicitConsent('pizza-a','cust-a',ref)).toBe(false);
    fake.text='AUTORIZO MEMÓRIA COMERCIAL';
    expect(await verifier.verifyExplicitConsent('pizza-a','cust-a',ref)).toBe(true);
    expect(await verifier.verifyExplicitConsent('pizza-b','cust-a',ref)).toBe(false);
    expect(await verifier.verifyCustomerEvidence('pizza-a','cust-b',ref)).toBe(false);
  });
});

describe('T02 — HTTP boundary and physical cleanup',()=>{
  it('runs the versioned profile HTTP endpoints with verified server-side roles',async()=>{
    const profiles=new ProfilesMemory();
    const app=express();
    app.use(express.json());
    // This test supplies a pre-authenticated TenantContext. The production API
    // mounts real authentication and tenant-membership middleware first.
    app.use('/business',(req,_res,next)=>{
      req.tenantContext=t('pizza-a',req.header('x-test-role')==='VIEWER'?'VIEWER':'OWNER');
      next();
    },createBusinessRouter({
      profiles,memories:new MemoriesMemory(),customers:new CustomerMemory([]),
      catalog:new CatalogMemory([item('a','pizza-a','Pizza Grande',5900)]),
      verifier:new VerifiedSources(),
    }));
    app.use(errorHandler);
    const server=app.listen(0,'127.0.0.1');
    await once(server,'listening');
    try {
      const port=(server.address() as AddressInfo).port;
      const root='http://127.0.0.1:'+port+'/business/units/main';
      const forbidden=await fetch(root+'/revisions',{
        method:'POST',headers:{'content-type':'application/json','x-test-role':'VIEWER'},
        body:JSON.stringify(profileInput()),
      });
      expect(forbidden.status).toBe(403);
      expect((await forbidden.json()).error.code).toBe('BUSINESS_MANAGEMENT_DENIED');
      const created=await fetch(root+'/revisions',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify(profileInput()),
      });
      expect(created.status).toBe(201);
      expect((await created.json()).data.version).toBe(1);
      const active=await fetch(root+'/active');
      expect(active.status).toBe(200);
      expect((await active.json()).data.identity.assistantName).toBe('Atendente Pizzaria');
      const price=await fetch(root+'/answer',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({question:'Quanto custa Pizza Grande?'}),
      });
      expect((await price.json()).data).toMatchObject({status:'ANSWERED',source:'CATALOG'});
      const missing=await fetch(root+'/answer',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({question:'Quanto custa Pizza Especial?'}),
      });
      expect((await missing.json()).data).toMatchObject({status:'UNKNOWN'});
    } finally {server.close();await once(server,'close');}
  });
  it('deletes expired memory in bounded batches without guessing counts',async()=>{
    const repository=new MemoriesMemory();
    const now=NOW;
    const r:ScopedCustomerMemory={
      tenantId:'pizza-a',unitId:'main',customerId:'cust-a',version:1,status:'GRANTED',
      summary:'Old.',interests:[],preferences:[],sourceRefs:[],updatedAt:NOW,
      expiresAt:'2026-11-20T00:00:00.000Z',updatedBy:'operator',
    };
    await repository.save(r,0);
    expect(await purgeExpiredBusinessMemories(repository,()=>new Date(now),2)).toBe(1);
    expect(await repository.get('pizza-a','main','cust-a')).toBeNull();
  });
});
