import { AICapability, AIRouterInterface } from './contracts';
import { GeminiAdapter } from './geminiAdapter';
import { createGeminiHttpTransportFromEnv } from './geminiHttpTransport';
import { AIRouter } from './router';

export const GEMINI_RUNTIME_CAPABILITIES: readonly AICapability[] = [
  'FAST_CHAT',
  'LEAD_CLASSIFICATION',
  'DATA_EXTRACTION',
  'GENERAL_REASONING',
];

export function createRuntimeAIRouter(env: NodeJS.ProcessEnv = process.env): AIRouterInterface {
  const providers = [];
  const geminiTransport = createGeminiHttpTransportFromEnv(env);

  if (geminiTransport) {
    providers.push(new GeminiAdapter(geminiTransport, GEMINI_RUNTIME_CAPABILITIES));
  }

  return new AIRouter(providers);
}
