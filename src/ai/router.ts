import { createErrorResult } from '../infrastructure/errors';
import { Result } from '../types/contracts';
import { AICapability, AIProviderInterface, AIRequest, AIResponse, AIRouterInterface } from './contracts';

function providerFailure(code: string, message: string): Result<AIResponse> {
  return createErrorResult('PROVIDER', code, message, true);
}

export class AIRouter implements AIRouterInterface {
  private readonly providers = new Map<string, AIProviderInterface>();

  constructor(providers: AIProviderInterface[]) {
    for (const provider of providers) {
      const id = provider.id.trim();
      if (!id) throw new Error('AI provider id is required.');
      if (this.providers.has(id)) throw new Error(`Duplicate AI provider id: ${id}`);
      this.providers.set(id, provider);
    }
  }

  async resolveProvider(capability: AICapability): Promise<Result<string>> {
    for (const provider of this.providers.values()) {
      if (provider.supports(capability)) return { ok: true, data: provider.id };
    }
    return createErrorResult('PROVIDER', 'AI_CAPABILITY_UNAVAILABLE', 'AI capability is unavailable.', false);
  }

  async execute(input: AIRequest): Promise<Result<AIResponse>> {
    if (!input.tenantId?.trim()) {
      return createErrorResult('VALIDATION', 'AI_TENANT_REQUIRED', 'Tenant is required.', false);
    }
    if (input.input === undefined || input.input === null) {
      return createErrorResult('VALIDATION', 'AI_INPUT_REQUIRED', 'AI input is required.', false);
    }

    const resolved = await this.resolveProvider(input.capability);
    if (!resolved.ok || !resolved.data) return resolved as Result<AIResponse>;
    const provider = this.providers.get(resolved.data);
    if (!provider) return providerFailure('AI_PROVIDER_UNAVAILABLE', 'AI provider is unavailable.');

    try {
      const result = await provider.generate({ ...input, tenantId: input.tenantId.trim() });
      if (!result.ok) {
        return {
          ok: false,
          error: {
            category: result.error?.category === 'RATE_LIMIT' ? 'RATE_LIMIT' : 'PROVIDER',
            code: result.error?.code || 'AI_PROVIDER_FAILURE',
            message: result.error?.message || 'AI provider request failed.',
            retryable: result.error?.retryable ?? true,
          },
        };
      }
      if (!result.data || result.data.provider !== provider.id || !result.data.model?.trim()) {
        return providerFailure('AI_RESPONSE_INVALID', 'AI provider returned an invalid response.');
      }
      return result;
    } catch {
      return providerFailure('AI_PROVIDER_FAILURE', 'AI provider request failed.');
    }
  }
}
