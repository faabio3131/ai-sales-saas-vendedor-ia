import {createGeminiSmokeRouter} from '../ai/runtime';
import type {AIRouterInterface} from '../ai/contracts';
import {ApplicationError} from '../infrastructure/errors';
const MARKER='VENDEDOR_IA_AI_OK';
// The Interactions API output budget includes reasoning. The real Contabo
// probe on gemini-3.8-flash was incomplete at 32 and completed at 512.
const SMOKE_OUTPUT_BUDGET=512;

/** Synthetic, bounded request only. Provider output is never returned. */
export async function runGeminiOperationalSmoke(tenantId:string,router?:AIRouterInterface){
 try{
  const result=await (router??createGeminiSmokeRouter()).execute({
   tenantId,capability:'FAST_CHAT',
   systemInstructions:'This is a provider connectivity smoke test. Return only the requested marker.',
   input:'Return exactly: '+MARKER,maxOutputTokens:SMOKE_OUTPUT_BUDGET,
   metadata:{purpose:'OP-040_REAL_AI_SMOKE'}
  });
  const data=result.data;
  if(!result.ok||!data||data.provider!=='gemini'||!data.model?.trim()||
     data.finishReason!=='completed'||data.content?.trim()!==MARKER)throw Error('invalid smoke');
  return {status:'READY' as const,provider:'gemini' as const,model:data.model,
   generated:true,expectedMarkerObserved:true,latencyMs:data.latencyMs,
   inputTokens:data.inputTokens,outputTokens:data.outputTokens,secretsExposed:false as const};
 }catch{
  throw new ApplicationError({category:'PROVIDER',code:'GEMINI_REAL_SMOKE_FAILED',
   message:'Gemini connectivity smoke failed.',retryable:true});
 }
}
