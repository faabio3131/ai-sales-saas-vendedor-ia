import { describe,expect,it } from 'vitest';
import type { BusinessProfileRepository } from '../src/business/contracts';
import type { BusinessProfileRevision } from '../src/business/model';
import type { CatalogRepository } from '../src/catalog/contracts';
import type { CatalogItem } from '../src/catalog/model';
import { BusinessGroundingService } from '../src/business/grounding';
import { UnitCatalogService } from '../src/commerce/service';
import { buildCognitiveContextPack } from '../src/ai/cognitiveContext';
import { InMemoryCatalog,catalogInput,ctx,NOW,profiles } from './helpers/t03Fixtures';

const fullProfile:BusinessProfileRevision={
  tenantId:'pizza-a',unitId:'main',version:1,
  effectiveFrom:'2026-01-01T00:00:00.000Z',
  createdAt:NOW,createdBy:'manager',
  identity:{assistantName:'Atendente',voiceStyle:'FRIENDLY'},
  capabilityRegistry:{vertical:'FOOD_SERVICE',capabilities:['FOOD_SERVICE','ORDERING','DELIVERY'],
    operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED'},
  policy:{timezone:'America/Sao_Paulo',locale:'pt-BR',memoryRetentionDays:30,
    personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},
  facts:[{id:'hours',kind:'HOURS',question:'Qual o horário?',
    answer:'Atendimento de terça a domingo.',sourceRef:'operator:hours'}],
};
const business={
  latest:async()=>fullProfile,
  effective:async(t:string,u:string)=>({...fullProfile,tenantId:t,unitId:u}),
  createRevision:async()=>{},
} as BusinessProfileRepository;
const legacyCatalog={
  listByTenant:async(t:string)=>[{id:'old',tenantId:t,name:'Combo da Casa',
    active:true,type:'PRODUCT',currency:'BRL',priceMinor:1,createdAt:NOW,updatedAt:NOW}] as CatalogItem[],
  findById:async()=>null,create:async(i:CatalogItem)=>i,update:async(i:CatalogItem)=>i,
} as CatalogRepository;
describe('T03 — unit-catalog source of truth for cognitive grounding',()=>{
  it('never answers with legacy tenant-wide prices when unit catalog is configured',async()=>{
    const repo=new InMemoryCatalog();
    const manager=new UnitCatalogService(repo,profiles,()=>new Date(NOW));
    await manager.publish(ctx(),'unit-a',catalogInput());
    const modified=catalogInput({
      items:catalogInput().items.map(p=>p.id==='combo'?{...p,priceMinor:6200}:p),
    });
    await manager.publish(ctx(),'unit-b',modified);
    const grounding=new BusinessGroundingService(business,legacyCatalog,repo);
    const a=await grounding.answer(ctx(),'unit-a','Quanto custa Combo da Casa?',NOW);
    const b=await grounding.answer(ctx(),'unit-b','Quanto custa Combo da Casa?',NOW);
    expect(a).toMatchObject({status:'ANSWERED',source:'CATALOG',evidenceIds:['unitcatalog:combo']});
    expect(a.answer).toContain('52,00');
    expect(b.answer).toContain('62,00');
    expect(a.answer).not.toContain('0,01');
    const missing=await grounding.answer(ctx(),'unit-missing','Quanto custa Combo da Casa?',NOW);
    expect(missing.status).toBe('UNKNOWN');
  });
  it('asks for pizza sizing/flavor instead of inventing a price from an ambiguous utterance',async()=>{
    const repo=new InMemoryCatalog();
    const manager=new UnitCatalogService(repo,profiles,()=>new Date(NOW));
    await manager.publish(ctx(),'main',catalogInput());
    const grounding=new BusinessGroundingService(business,legacyCatalog,repo);
    expect((await grounding.answer(ctx(),'main','Quanto custa Pizza?',NOW)).status).toBe('UNKNOWN');
    expect((await grounding.answer(ctx(),'main','Quanto custa Refrigerante?',NOW)).status).toBe('UNKNOWN');
    const info=await grounding.answer(ctx(),'main','Qual o horário?',NOW);
    expect(info).toMatchObject({status:'ANSWERED',source:'BUSINESS_APPROVED'});
    const ai=await grounding.groundedAIRequest(ctx(),'main',{stage:'NOVO'},NOW);
    const pack=buildCognitiveContextPack(ai);
    expect(pack.evidenceIds).toContain('unitcatalog:pizza');
    expect(pack.trustedFacts).toContain('Tamanhos: Pequena, Grande');
    expect(pack.trustedFacts).toContain('Sabores: Marguerita, Calabresa');
    expect(pack.trustedFacts).not.toContain('0,01');
  });
});
