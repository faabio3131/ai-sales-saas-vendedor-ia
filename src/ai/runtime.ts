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

/** Python S2S route first when configured, Gemini second, safe deterministic SalesEngine last. */
export function createRuntimeAIRouter(
  env:NodeJS.ProcessEnv=process.env,
  meter?:CognitiveMeteringSink,
):AIRouterInterface {
  const providers:AIProviderInterface[]=[];
  const cognitive=cognitiveSettingsFromEnv(env);
  if(cognitive)providers.push(new CognitiveServiceAdapter(cognitive));
  const geminiTransport=createGeminiHttpTransportFromEnv(env);
  if(geminiTransport)providers.push(new GeminiAdapter(geminiTransport,GEMINI_RUNTIME_CAPABILITIES));
  return new ResilientAIRouter(providers,{
    meter:meter??(env.COGNITIVE_METERING_ENABLED==='true'?new FirestoreCognitiveMeteringSink():undefined),
  });
}
