import { AICapability, AIProviderInterface, AIRouterInterface } from './contracts';
import { GeminiAdapter } from './geminiAdapter';
import { createGeminiHttpTransportFromEnv } from './geminiHttpTransport';
import { CognitiveServiceAdapter, cognitiveSettingsFromEnv } from './cognitiveServiceAdapter';
import { FirestoreCognitiveMeteringSink } from './cognitiveFinops';
import type { CognitiveMeteringSink } from './cognitiveFinops';
import { ResilientAIRouter } from './resilientRouter';

export const GEMINI_RUNTIME_CAPABILITIES: readonly AICapability[] = [
  'FAST_CHAT',
  'LEAD_CLASSIFICATION',
  'DATA_EXTRACTION',
  'GENERAL_REASONING',
];

/** Dedicated operational smoke: never route to a fallback and call it Gemini. */
export function createGeminiSmokeRouter(env:NodeJS.ProcessEnv=process.env):AIRouterInterface {
  const transport=createGeminiHttpTransportFromEnv(env);
  return new ResilientAIRouter(transport?[new GeminiAdapter(transport,GEMINI_RUNTIME_CAPABILITIES)]:[],{timeoutMs:15000});
}

/** Python S2S route first when configured, Gemini second, safe deterministic SalesEngine last. */
export function createRuntimeAIRouter(
  env:NodeJS.ProcessEnv=process.env,
  meter?:CognitiveMeteringSink,
):AIRouterInterface {
  const providers:AIProviderInterface[]=[];
  const cognitive=cognitiveSettingsFromEnv(env);
  const cognitiveAdapter=cognitive?new CognitiveServiceAdapter(cognitive):null;
  const geminiTransport=createGeminiHttpTransportFromEnv(env);
  const geminiAdapter=geminiTransport?new GeminiAdapter(geminiTransport,GEMINI_RUNTIME_CAPABILITIES):null;
  // Preserve an already-connected Gemini provider by default. The read-only
  // Python baseline is a safe fallback until a model-backed route is approved.
  if (env.COGNITIVE_ROUTE_PRIORITY==='COGNITIVE_FIRST' && cognitiveAdapter) providers.push(cognitiveAdapter);
  if (geminiAdapter) providers.push(geminiAdapter);
  if (cognitiveAdapter && !providers.includes(cognitiveAdapter)) providers.push(cognitiveAdapter);
  return new ResilientAIRouter(providers,{
    meter:meter??(env.COGNITIVE_METERING_ENABLED==='true'?new FirestoreCognitiveMeteringSink():undefined),
  });
}
