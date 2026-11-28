import { GeminiAdapter } from '../ai/geminiAdapter';
import { GeminiHttpTransport } from '../ai/geminiHttpTransport';
import { geminiRuntimeSecret } from '../ai/geminiRuntimeSecret';
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
  let apiKey: string | null = null;
  try { apiKey = geminiRuntimeSecret(deps.env); } catch { /* invalid mount: fail closed */ }
  const apiKeyConfigured = Boolean(apiKey);
  const model = deps.env.GEMINI_MODEL?.trim() || null;
  const modelConfigured = Boolean(model);
  let providerReachable = false;

  if (apiKey && model) {
    try {
      if (deps.probeProvider) {
        providerReachable = await deps.probeProvider();
      } else {
        const adapter = new GeminiAdapter(new GeminiHttpTransport({apiKey,model}), GEMINI_RUNTIME_CAPABILITIES);
        providerReachable = (await adapter.healthCheck()).ok;
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
