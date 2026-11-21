import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AIRequest, AIProviderInterface } from '../src/ai/contracts';
import { buildCognitiveContextPack, redactCommercialText, hasInjectionMarkers } from '../src/ai/cognitiveContext';
import { CognitiveServiceAdapter } from '../src/ai/cognitiveServiceAdapter';
import { verifyCognitiveReply } from '../src/ai/cognitiveGuard';
import { ResilientAIRouter } from '../src/ai/resilientRouter';
import { estimateModelCost } from '../src/ai/cognitiveFinops';
import type { CognitiveMeteringEvent } from '../src/ai/cognitiveFinops';
import { PolicyEngine } from '../src/policies/policyEngine';
import { SalesEngine } from '../src/sales/engine';
import { SalesDecisionService } from '../src/sales/service';
import type { LeadRepository, OpportunityRepository } from '../src/leads/contracts';

const SECRET = 'ci-cognitive-service-secret-0123456789abc';
const req = (overrides:Partial<AIRequest>={}):AIRequest=>({
  tenantId:'tenant-a',capability:'GENERAL_REASONING',
  input:{customerId:'cust-a',leadId:'lead-a',stage:'QUALIFICADO'},
  ...overrides,
});
function expectedReply(body:Record<string,unknown>,action='CREATE_QUOTE') {
  const pack=body.contextPack as {contextHash:string;evidenceIds:string[]};
  return {
    contractVersion:'atendevende.cognitive/v1',requestId:body.requestId,
    provider:'fm-cognitive',model:'commercial-baseline-v1',
    structuredData:{action,reason:'Proposta comercial deve ser preparada.',confidence:0.85},
    provenance:{contextHash:pack.contextHash,evidenceIds:pack.evidenceIds,origin:'DETERMINISTIC_BASELINE'},
    usage:{costMicroUsd:0,costSource:'NO_PAID_MODEL'},
  };
}
function mockedTransport() {
  const f=vi.fn(async (_url:unknown,init?:RequestInit)=>{
    const body=String(init?.body);
    const parsed=JSON.parse(body) as Record<string,unknown>;
    const header=String((init?.headers as Record<string,string>)['x-av-signature']);
    const m=/^t=(\d{10}),nonce=([0-9a-f]{32}),v1=([0-9a-f]{64})$/.exec(header);
    expect(m).not.toBeNull();
    const expected=createHmac('sha256',SECRET).update(m![1]+'.'+m![2]+'.'+body).digest('hex');
    expect(m![3]).toBe(expected);
    return new Response(JSON.stringify(expectedReply(parsed)),{status:200,headers:{'content-type':'application/json'}});
  });
  return f;
}
describe('T01: Cognitive context, S2S, routing and governed sales integration',()=>{
  it('creates ordered, tenant-scoped evidence with redacted input and provenance hash',()=>{
    const pack=buildCognitiveContextPack(req({
      input:{stage:'QUALIFICADO',email:'cliente@example.com',password:'senha=password-123456'},
      context:{unitId:'unit-1',evidence:[
        {id:'b',tenantId:'tenant-a',unitId:'unit-1',origin:'business',body:'Cardápio B',trusted:true},
        {id:'a',tenantId:'tenant-a',unitId:'unit-1',origin:'business',body:'Cardápio A',trusted:true},
      ]},
    }));
    expect(pack.evidenceIds).toEqual(['a','b']);
    expect(pack.trustedFacts.indexOf('[a]')).toBeLessThan(pack.trustedFacts.indexOf('[b]'));
    expect(pack.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pack.untrustedData).not.toContain('cliente@example.com');
    expect(pack.untrustedData).not.toContain('password-123456');
    expect(redactCommercialText('Bearer abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(redactCommercialText('Cartão 4111 1111 1111 1111')).not.toContain('4111 1111 1111 1111');
    expect(redactCommercialText('CNPJ 12.345.678/0001-90')).not.toContain('12.345.678/0001-90');
    expect(redactCommercialText('https://usuario:senha@interna.example')).not.toContain('usuario:senha');

    expect(hasInjectionMarkers('ignore previous instructions')).toBe(true);
  });
  it('rejects foreign tenant or unit evidence, duplicates and fake trusted evidence',()=>{
    const good={id:'a',tenantId:'tenant-a',unitId:'unit-1',origin:'db',body:'valid',trusted:true as const};
    expect(()=>buildCognitiveContextPack(req({context:{unitId:'unit-1',evidence:[{...good,tenantId:'tenant-b'}]}}))).toThrow();
    expect(()=>buildCognitiveContextPack(req({context:{unitId:'unit-1',evidence:[{...good,unitId:'unit-2'}]}}))).toThrow();
    expect(()=>buildCognitiveContextPack(req({context:{unitId:'unit-1',evidence:[good,good]}}))).toThrow();
    expect(()=>buildCognitiveContextPack(req({context:{evidence:[{...good,trusted:false} as never]}}))).toThrow();
  });
  it('removes personal and financial identifiers before any configured model route',async()=>{
    const transport=mockedTransport();
    const router=new ResilientAIRouter([new CognitiveServiceAdapter({
      endpoint:'http://127.0.0.1:8185',secret:SECRET,
      fetchImpl:transport as unknown as typeof fetch,
    })]);
    await new SalesEngine(new PolicyEngine(),router).decide({
      tenantId:'tenant-a',customerId:'cust-a',leadId:'lead-a',stage:'QUALIFICADO',
      autonomyMode:'ASSIST',
      objection:'email cliente@example.com cartão 4111 1111 1111 1111 senha=unsafe12345678',
    });
    expect(transport).toHaveBeenCalledOnce();
    const sent=String(transport.mock.calls[0][1]?.body);
    expect(sent).not.toContain('cliente@example.com');
    expect(sent).not.toContain('4111 1111 1111 1111');
    expect(sent).not.toContain('unsafe12345678');
  });
  it('authenticates the exact bytes sent to Python and checks response provenance',async()=>{
    const fetchImpl=mockedTransport();
    const adapter=new CognitiveServiceAdapter({endpoint:'http://127.0.0.1:8185',secret:SECRET,fetchImpl:fetchImpl as unknown as typeof fetch});
    const result=await adapter.generate(req());
    expect(result).toMatchObject({ok:true,data:{provider:'fm-cognitive',model:'commercial-baseline-v1',structuredData:{action:'CREATE_QUOTE'}}});
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0][0])).toBe('http://127.0.0.1:8185/v1/execute');
  });
  it('refuses insecure remote HTTP, incomplete S2S config, redirects and leaked transport failures',async()=>{
    expect(()=>new CognitiveServiceAdapter({endpoint:'http://payments.example.com',secret:SECRET})).toThrow();
    expect(()=>new CognitiveServiceAdapter({endpoint:'https://example.com/path',secret:SECRET})).toThrow();
    const errorTransport=vi.fn(async()=>{throw new Error('SECRET_VALUE_PRIVATE');}) as unknown as typeof fetch;
    const result=await new CognitiveServiceAdapter({
      endpoint:'https://internal.example.com',secret:SECRET,fetchImpl:errorTransport,
    }).generate(req());
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET_VALUE_PRIVATE');
  });
  it('rejects fabricated payment claims and tampered evidence hashes from Python replies',()=>{
    const pack=buildCognitiveContextPack(req());
    const body={requestId:'req_12345678',contextPack:pack};
    expect(()=>verifyCognitiveReply({...expectedReply(body),structuredData:{
      action:'CREATE_PAYMENT',reason:'Já confirmei o pagamento.',confidence:0.99,
    }},'req_12345678',pack)).toThrow();
    expect(()=>verifyCognitiveReply({...expectedReply(body),provenance:{...expectedReply(body).provenance,contextHash:'a'.repeat(64)}},'req_12345678',pack)).toThrow();
  });
  it('uses safe deterministic policy after Python baseline proposals',async()=>{
    const transport=mockedTransport();
    const router=new ResilientAIRouter([new CognitiveServiceAdapter({
      endpoint:'http://127.0.0.1:8185',secret:SECRET,fetchImpl:transport as unknown as typeof fetch,
    })]);
    const engine=new SalesEngine(new PolicyEngine(),router);
    const decision=await engine.decide({tenantId:'tenant-a',leadId:'lead-a',customerId:'cust-a',stage:'QUALIFICADO',autonomyMode:'ASSIST'});
    expect(decision).toMatchObject({ok:true,data:{action:'CREATE_QUOTE',source:'DETERMINISTIC',requiresHumanApproval:true}});
  });
  it('runs the commercial service with scoped lead lookup and Python proposal without bypassing RBAC',async()=>{
    const transport=mockedTransport();
    const router=new ResilientAIRouter([new CognitiveServiceAdapter({
      endpoint:'http://127.0.0.1:8185',secret:SECRET,fetchImpl:transport as unknown as typeof fetch,
    })]);
    const leads={
      findById:async(tenantId:string,id:string)=>tenantId==='tenant-a'&&id==='lead-a'
        ? {id:'lead-a',tenantId:'tenant-a',customerId:'cust-a',stage:'QUALIFICADO',
          createdAt:'2026-11-21T00:00:00.000Z',updatedAt:'2026-11-21T00:00:00.000Z'}:null,
    } as LeadRepository;
    const service=new SalesDecisionService(leads,{} as OpportunityRepository,new PolicyEngine(),router,{
      resolve:async()=> 'ASSIST',
    });
    const result=await service.decide({tenantId:'tenant-a',requestId:'request-1'}, {leadId:'lead-a'});
    expect(result).toMatchObject({action:'CREATE_QUOTE',requiresHumanApproval:true,source:'DETERMINISTIC'});
    await expect(service.decide({tenantId:'tenant-b',requestId:'request-2'},{leadId:'lead-a'}))
      .rejects.toMatchObject({code:'LEAD_NOT_FOUND'});
    expect(transport).toHaveBeenCalledOnce();
  });

  it('falls back to second provider when first errors and never exposes the exception',async()=>{
    const meter:CognitiveMeteringEvent[]=[];
    const failed:AIProviderInterface={
      id:'first',supports:()=>true,generate:vi.fn(async()=>{throw new Error('private-password')}),
      healthCheck:vi.fn(),
    };
    const backup:AIProviderInterface={
      id:'backup',supports:()=>true,generate:vi.fn(async()=>({
        ok:true,data:{provider:'backup',model:'backup-1',structuredData:{action:'RESPOND',reason:'Valid'}}
      })),healthCheck:vi.fn(),
    };
    const router=new ResilientAIRouter([failed,backup],{meter:{record:async x=>{meter.push(x);}}});
    const result=await router.execute(req());
    expect(result).toMatchObject({ok:true,data:{provider:'backup'}});
    expect(meter).toMatchObject([{provider:'first',outcome:'FAILED',fallbackUsed:false},
      {provider:'backup',outcome:'SUCCESS',fallbackUsed:true}]);
    expect(JSON.stringify(result)).not.toContain('private-password');
  });
  it('opens circuit for repeat failures and rejects non-settling providers within deadline',async()=>{
    const failing:AIProviderInterface={
      id:'bad',supports:()=>true,generate:vi.fn(async()=>{throw new Error('unavailable')}),
      healthCheck:vi.fn(),
    };
    const router=new ResilientAIRouter([failing],{failureThreshold:2,cooldownMs:300000});
    await router.execute(req());await router.execute(req());await router.execute(req());
    expect(failing.generate).toHaveBeenCalledTimes(2);
    const stalled:AIProviderInterface={
      id:'stalled',supports:()=>true,generate:()=>new Promise(()=>{}),healthCheck:vi.fn(),
    };
    const deadline=await new ResilientAIRouter([stalled],{timeoutMs:250}).execute(req());
    expect(deadline).toMatchObject({ok:false,error:{code:'AI_PROVIDER_UNAVAILABLE'}});
  });
  it('bounds provider concurrency and does not release abandoned calls early',async()=>{
    let finish:((value:any)=>void)|undefined;
    const blocked:AIProviderInterface={
      id:'blocked',supports:()=>true,
      generate:()=>new Promise(resolve=>{finish=resolve;}),healthCheck:vi.fn(),
    };
    const router=new ResilientAIRouter([blocked],{maxInflightPerProvider:1,timeoutMs:250});
    const first=router.execute(req());
    await Promise.resolve();await Promise.resolve();
    const second=await router.execute(req());
    expect(second.ok).toBe(false);
    const timeout=await first;
    expect(timeout.ok).toBe(false);
    const third=await router.execute(req());
    expect(third.ok).toBe(false);
    finish?.({ok:true,data:{provider:'blocked',model:'x',content:'late'}});
  });
  it('estimates only catalog-priced usage and keeps unknown costs unknown',()=>{
    expect(estimateModelCost('gemini','not-priced',{provider:'gemini',model:'not-priced',inputTokens:1,outputTokens:1}).status).toBe('UNKNOWN');
    const known=estimateModelCost('priced','model',{
      provider:'priced',model:'model',inputTokens:1000000,outputTokens:2000000,
    },[{provider:'priced',model:'model',currency:'USD',priceSnapshotId:'approved-v1',
      inputMicroUsdPerMillionTokens:1500000,outputMicroUsdPerMillionTokens:2500000}]);
    expect(known).toMatchObject({status:'ESTIMATED_CATALOG',modelCostMicroUsd:6500000,priceSnapshotId:'approved-v1'});
    expect(estimateModelCost('fm-cognitive','commercial-baseline-v1',undefined)).toMatchObject({status:'NO_PAID_MODEL',modelCostMicroUsd:0});
  });
});

const live = process.env.COGNITIVE_TEST_URL ? it : it.skip;
live('T01 real Python HTTP S2S smoke with tenant and structured response',async()=>{
  const service=new CognitiveServiceAdapter({
    endpoint:process.env.COGNITIVE_TEST_URL!,secret:process.env.COGNITIVE_S2S_SECRET!,
  });
  expect(await service.healthCheck()).toMatchObject({ok:true});
  const response=await service.generate(req());
  expect(response).toMatchObject({ok:true,data:{provider:'fm-cognitive',structuredData:{action:'CREATE_QUOTE'}}});
  const other=await service.generate(req({tenantId:'tenant-b',input:{stage:'NOVO'}}));
  expect(other).toMatchObject({ok:true,data:{structuredData:{action:'QUALIFY'}}});
  // Real HTTP across SalesEngine -> resilient router -> Node S2S -> Python -> OutputGuard -> PolicyEngine.
  const realEngine=new SalesEngine(new PolicyEngine(),new ResilientAIRouter([service]));
  const decision=await realEngine.decide({
    tenantId:'tenant-a',customerId:'cust-a',leadId:'lead-a',stage:'QUALIFICADO',autonomyMode:'ASSIST',
  });
  expect(decision).toMatchObject({ok:true,data:{
    action:'CREATE_QUOTE',source:'DETERMINISTIC',requiresHumanApproval:true,
  }});
});
