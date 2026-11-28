import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {geminiRuntimeSecret} from '../src/ai/geminiRuntimeSecret';
import {GeminiHttpTransport,createGeminiHttpTransportFromEnv} from '../src/ai/geminiHttpTransport';
import {GeminiAdapter} from '../src/ai/geminiAdapter';
import {ResilientAIRouter} from '../src/ai/resilientRouter';
import {evaluateAIRealReadiness} from '../src/operations/aiRealReadiness';
import {runGeminiOperationalSmoke} from '../src/operations/geminiOperationalSmoke';
import type {AIResponse,AIRouterInterface} from '../src/ai/contracts';

const FIXTURE='synthetic-gemini-fixture-only-0123456789';
let dir:string,file:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'gemini-mount-'));file=join(dir,'key');writeFileSync(file,FIXTURE+'\n',{mode:0o600});});
afterEach(()=>rmSync(dir,{recursive:true,force:true}));
describe('Gemini private credential and real readiness',()=>{
 it('uses the same private mount in transport, readiness and the legacy worker',async()=>{
  for(const key of ['GEMINI_API_KEY_FILE','EVOLUTION_GEMINI_SECRET_FILE']){
   const env={[key]:file,GEMINI_MODEL:'gemini-fixture'};
   expect(geminiRuntimeSecret(env)).toBe(FIXTURE);
   expect(createGeminiHttpTransportFromEnv(env)).not.toBeNull();
   const probe=vi.fn(async()=>true);
   const report=await evaluateAIRealReadiness({env,probeProvider:probe});
   expect(report).toMatchObject({status:'READY',apiKeyConfigured:true,secretsExposed:false});
   expect(probe).toHaveBeenCalledOnce();
   expect(JSON.stringify(report)).not.toContain(FIXTURE);
  }
  chmodSync(file,0o400);
  expect(geminiRuntimeSecret({GEMINI_API_KEY_FILE:file})).toBe(FIXTURE);
  expect(geminiRuntimeSecret({GEMINI_API_KEY:'legacy-fixture'})).toBe('legacy-fixture');
  expect(geminiRuntimeSecret({})).toBeNull();
 });
 it('rejects ambiguous credentials before making a request',async()=>{
  for(const env of [{GEMINI_API_KEY:FIXTURE,GEMINI_API_KEY_FILE:file},
    {GEMINI_API_KEY_FILE:file,EVOLUTION_GEMINI_SECRET_FILE:file}]){
   expect(()=>geminiRuntimeSecret(env)).toThrow('GEMINI_SECRET_SOURCE_AMBIGUOUS');
   const probe=vi.fn(async()=>true);
   const report=await evaluateAIRealReadiness({env:{...env,GEMINI_MODEL:'gemini-fixture'},probeProvider:probe});
   expect(report.status).toBe('DEGRADED');expect(probe).not.toHaveBeenCalled();
  }
 });
 it('rejects missing, linked, nonregular, public, short, oversized, and malformed mounts',async()=>{
  const link=join(dir,'link'),folder=join(dir,'folder');
  symlinkSync(file,link);mkdirSync(folder);
  chmodSync(file,0o644);
  for(const path of [file,link,folder,join(dir,'missing')]){
   expect(()=>geminiRuntimeSecret({GEMINI_API_KEY_FILE:path})).toThrow('GEMINI_SECRET_FILE_INVALID');
  }
  chmodSync(file,0o600);
  for(const value of ['tiny','x'.repeat(1025),'synthetic value with embedded whitespace','x'.repeat(21)+'\u0000']){
   writeFileSync(file,value);
   expect(()=>geminiRuntimeSecret({GEMINI_API_KEY_FILE:file})).toThrow('GEMINI_SECRET_FILE_INVALID');
  }
  const probe=vi.fn(async()=>true);
  const report=await evaluateAIRealReadiness({env:{GEMINI_API_KEY_FILE:file,GEMINI_MODEL:'gemini-fixture'},probeProvider:probe});
  expect(report).toMatchObject({status:'DEGRADED',apiKeyConfigured:false,providerReachable:false});
  expect(probe).not.toHaveBeenCalled();
  expect(JSON.stringify(report)).not.toContain(file);
 });
});
describe('Gemini connectivity cannot be certified by a fallback',()=>{
 const success:AIResponse={provider:'gemini',model:'gemini-fixture',content:'VENDEDOR_IA_AI_OK',finishReason:'completed'};
 const router=(data:AIResponse):AIRouterInterface=>({resolveProvider:vi.fn(),execute:vi.fn(async()=>({ok:true,data}))});
 it('returns a sanitized marker only for completed Gemini generation',async()=>{
  const r=router(success),report=await runGeminiOperationalSmoke('fixture',r);
  expect(report).toMatchObject({status:'READY',provider:'gemini',generated:true,expectedMarkerObserved:true,secretsExposed:false});
  expect(report).not.toHaveProperty('content');
  expect(r.execute).toHaveBeenCalledWith(expect.objectContaining({tenantId:'fixture',maxOutputTokens:512}));
 });
 it('reproduces the real token-budget regression through transport, adapter and router',async()=>{
  const fetchImpl=vi.fn(async (_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   const enough=body.generation_config?.max_output_tokens===512;
   return new Response(JSON.stringify({
    model:'gemini-3.8-flash',status:enough?'completed':'incomplete',
    steps:[
     {type:'thought',content:[{type:'text',text:'internal reasoning must not be returned'}]},
     {type:'model_output',content:[{type:'text',text:enough?'VENDEDOR_IA_AI_OK':'VENDED'}]}
    ],
    usage:{total_thought_tokens:enough?119:26,total_output_tokens:enough?9:2}
   }),{status:200});
  });
  const transport=new GeminiHttpTransport({apiKey:FIXTURE,model:'gemini-3.8-flash',fetchImpl});
  const r=new ResilientAIRouter([new GeminiAdapter(transport,['FAST_CHAT'])]);
  const insufficient=await r.execute({tenantId:'fixture',capability:'FAST_CHAT',input:'Return exactly: VENDEDOR_IA_AI_OK',maxOutputTokens:32});
  expect(insufficient).toMatchObject({ok:true,data:{finishReason:'incomplete',content:'VENDED'}});
  const report=await runGeminiOperationalSmoke('fixture',r);
  expect(report).toMatchObject({status:'READY',provider:'gemini',model:'gemini-3.8-flash',outputTokens:9,expectedMarkerObserved:true,secretsExposed:false});
  expect(report).not.toHaveProperty('content');
  expect(JSON.stringify(report)).not.toContain('internal reasoning');
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const body=JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
  expect(body).toMatchObject({store:false,generation_config:{max_output_tokens:512}});
 });
 it('rejects fallback, wrong marker, incomplete and failed results',async()=>{
  for(const patch of [{provider:'cognitive'},{content:'wrong-marker'},{finishReason:'incomplete'},{model:''}]){
   await expect(runGeminiOperationalSmoke('fixture',router({...success,...patch}))).rejects.toMatchObject({code:'GEMINI_REAL_SMOKE_FAILED'});
  }
  const r=router(success);
  vi.mocked(r.execute).mockRejectedValue(new Error('private error details'));
  await expect(runGeminiOperationalSmoke('fixture',r)).rejects.toThrow('Gemini connectivity smoke failed.');
  vi.mocked(r.execute).mockResolvedValue({ok:false});
  await expect(runGeminiOperationalSmoke('fixture',r)).rejects.toMatchObject({code:'GEMINI_REAL_SMOKE_FAILED'});
 });
});
