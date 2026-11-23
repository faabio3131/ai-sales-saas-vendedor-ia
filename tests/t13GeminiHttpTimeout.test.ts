import {describe,it,expect,vi} from 'vitest';
import {GeminiHttpTransport} from '../src/ai/geminiHttpTransport';

describe('T13 bounded HTTP timeouts for Gemini',()=>{
 it('passes an AbortSignal to both inference and health requests',async()=>{
  const signals:AbortSignal[]=[];
  const fake=vi.fn(async (_url:string|URL|Request,init?:RequestInit)=>{
   expect(init?.signal).toBeInstanceOf(AbortSignal);
   signals.push(init!.signal as AbortSignal);
   if(init?.method==='POST')return {ok:true,json:async()=>({
    status:'completed',output_text:'ok',
   })} as Response;
   return {ok:true} as Response;
  }) as unknown as typeof fetch;
  const client=new GeminiHttpTransport({apiKey:'unit-only',model:'gemini-test',
   fetchImpl:fake,timeoutMs:2000});
  const result=await client.generate({tenantId:'tenant-a',capability:'FAST_CHAT',input:'hi'});
  expect(result.content).toBe('ok');
  expect(await client.healthCheck()).toBe(true);
  expect(signals).toHaveLength(2);
  expect(signals.every(s=>s.aborted===false)).toBe(true);
 });
});
