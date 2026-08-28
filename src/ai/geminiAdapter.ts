import { createErrorResult } from '../infrastructure/errors';
import { Result } from '../types/contracts';
import { AICapability, AIProviderInterface, AIRequest, AIResponse } from './contracts';

export interface GeminiTransport {
  generate(request: AIRequest): Promise<{
    model: string;
    content?: string;
    structuredData?: unknown;
    toolCalls?: unknown[];
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: string;
  }>;
  healthCheck(): Promise<boolean>;
}

export class GeminiAdapter implements AIProviderInterface {
  readonly id = 'gemini';

  constructor(
    private readonly transport: GeminiTransport,
    private readonly capabilities: readonly AICapability[],
  ) {}

  supports(capability: AICapability): boolean {
    return this.capabilities.includes(capability);
  }

  async generate(input: AIRequest): Promise<Result<AIResponse>> {
    if (!this.supports(input.capability)) {
      return createErrorResult('PROVIDER', 'AI_CAPABILITY_UNSUPPORTED', 'AI capability is unsupported by this provider.', false);
    }
    const startedAt = Date.now();
    try {
      const output = await this.transport.generate(input);
      if (!output.model?.trim()) {
        return createErrorResult('PROVIDER', 'AI_RESPONSE_INVALID', 'AI provider returned an invalid response.', true);
      }
      return {
        ok: true,
        data: {
          ...output,
          provider: this.id,
          model: output.model,
          latencyMs: Math.max(0, Date.now() - startedAt),
        },
      };
    } catch {
      return createErrorResult('PROVIDER', 'GEMINI_REQUEST_FAILED', 'AI provider request failed.', true);
    }
  }

  async healthCheck(): Promise<Result<unknown>> {
    try {
      const healthy = await this.transport.healthCheck();
      return healthy
        ? { ok: true, data: { provider: this.id, status: 'ok' } }
        : createErrorResult('PROVIDER', 'GEMINI_UNAVAILABLE', 'AI provider is unavailable.', true);
    } catch {
      return createErrorResult('PROVIDER', 'GEMINI_UNAVAILABLE', 'AI provider is unavailable.', true);
    }
  }
}
