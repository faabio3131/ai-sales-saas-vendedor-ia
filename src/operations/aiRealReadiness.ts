import { GeminiAdapter } from '../ai/geminiAdapter';
import { createGeminiHttpTransportFromEnv } from '../ai/geminiHttpTransport';
import { GEMINI_RUNTIME_CAPABILITIES } from '../ai/runtime';

export interface AIRealReadinessReport {
  status: 'READY' | 'DEGRADED';
  provider: 'gemini';
  apiKeyConfigured: boolean;
  modelConfigured: boolean;
  model: string | null;
  providerReachable: boolean;
  capabilities: readonly string[];
  secretsExposed: false;
}

export interface AIRealReadinessDependencies {
  env: NodeJS.ProcessEnv;
  probeProvider?: () => Promise<boolean>;
}

export async function evaluateAIRealReadiness(
  deps: AIRealReadinessDependencies = { env: process.env },
): Promise<AIRealReadinessReport> {
  const apiKeyConfigured = Boolean(deps.env.GEMINI_API_KEY?.trim());
  const model = deps.env.GEMINI_MODEL?.trim() || null;
  const modelConfigured = Boolean(model);
  let providerReachable = false;

  if (apiKeyConfigured && modelConfigured) {
    try {
      if (deps.probeProvider) {
        providerReachable = await deps.probeProvider();
      } else {
        const transport = createGeminiHttpTransportFromEnv(deps.env);
        if (transport) {
          const adapter = new GeminiAdapter(transport, GEMINI_RUNTIME_CAPABILITIES);
          providerReachable = (await adapter.healthCheck()).ok;
        }
      }
    } catch {
      providerReachable = false;
    }
  }

  return {
    status: apiKeyConfigured && modelConfigured && providerReachable ? 'READY' : 'DEGRADED',
    provider: 'gemini',
    apiKeyConfigured,
    modelConfigured,
    model,
    providerReachable,
    capabilities: GEMINI_RUNTIME_CAPABILITIES,
    secretsExposed: false,
  };
}
