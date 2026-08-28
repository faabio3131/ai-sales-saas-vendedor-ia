import { describe, expect, it, vi } from 'vitest';
import { AIProviderInterface, AIRequest } from '../src/ai/contracts';
import { AIRouter } from '../src/ai/router';
import { GeminiAdapter } from '../src/ai/geminiAdapter';

const request = (overrides: Partial<AIRequest> = {}): AIRequest => ({
  tenantId: 'tenant-a',
  capability: 'FAST_CHAT',
  input: 'Olá',
  ...overrides,
});

describe('BLK-070: AI Foundation', () => {
  it('routes by capability without business code depending on a concrete provider', async () => {
    const first: AIProviderInterface = {
      id: 'provider-a',
      supports: (capability) => capability === 'DATA_EXTRACTION',
      generate: vi.fn(),
      healthCheck: vi.fn(),
    };
    const second: AIProviderInterface = {
      id: 'provider-b',
      supports: (capability) => capability === 'FAST_CHAT',
      generate: vi.fn(async () => ({ ok: true, data: { provider: 'provider-b', model: 'model-b', content: 'Resposta' } })),
      healthCheck: vi.fn(),
    };
    const result = await new AIRouter([first, second]).execute(request());
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ provider: 'provider-b', model: 'model-b', content: 'Resposta' });
    expect(first.generate).not.toHaveBeenCalled();
    expect(second.generate).toHaveBeenCalledOnce();
  });

  it('requires tenant identity before any provider call', async () => {
    const provider: AIProviderInterface = {
      id: 'provider-a',
      supports: () => true,
      generate: vi.fn(),
      healthCheck: vi.fn(),
    };
    const result = await new AIRouter([provider]).execute(request({ tenantId: '   ' }));
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AI_TENANT_REQUIRED');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('returns a normalized error when no provider supports a capability', async () => {
    const result = await new AIRouter([]).execute(request({ capability: 'VISION' }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ category: 'PROVIDER', code: 'AI_CAPABILITY_UNAVAILABLE' });
  });

  it('sanitizes exceptions thrown by a provider', async () => {
    const provider: AIProviderInterface = {
      id: 'provider-a',
      supports: () => true,
      generate: vi.fn(async () => { throw new Error('secret provider stack/API detail'); }),
      healthCheck: vi.fn(),
    };
    const result = await new AIRouter([provider]).execute(request());
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret provider stack');
    expect(result.error?.code).toBe('AI_PROVIDER_FAILURE');
  });

  it('rejects provider responses that violate the normalized response contract', async () => {
    const provider: AIProviderInterface = {
      id: 'provider-a',
      supports: () => true,
      generate: vi.fn(async () => ({ ok: true, data: { provider: 'wrong-provider', model: '', content: 'bad' } })),
      healthCheck: vi.fn(),
    };
    const result = await new AIRouter([provider]).execute(request());
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('AI_RESPONSE_INVALID');
  });

  it('normalizes the first Gemini adapter behind a transport boundary', async () => {
    const transport = {
      generate: vi.fn(async () => ({ model: 'gemini-test-model', content: 'Olá do adapter', inputTokens: 3, outputTokens: 4 })),
      healthCheck: vi.fn(async () => true),
    };
    const adapter = new GeminiAdapter(transport, ['FAST_CHAT']);
    const result = await adapter.generate(request());
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ provider: 'gemini', model: 'gemini-test-model', content: 'Olá do adapter', inputTokens: 3, outputTokens: 4 });
    expect(await adapter.healthCheck()).toMatchObject({ ok: true });
  });

  it('does not expose Gemini transport failures', async () => {
    const adapter = new GeminiAdapter({
      generate: vi.fn(async () => { throw new Error('API_KEY=never-leak-this'); }),
      healthCheck: vi.fn(async () => { throw new Error('private health detail'); }),
    }, ['FAST_CHAT']);
    const result = await adapter.generate(request());
    const health = await adapter.healthCheck();
    expect(JSON.stringify(result)).not.toContain('never-leak-this');
    expect(JSON.stringify(health)).not.toContain('private health detail');
    expect(result.error?.code).toBe('GEMINI_REQUEST_FAILED');
  });
});
