import { describe, expect, it, vi } from 'vitest';
import { GeminiHttpTransport, createGeminiHttpTransportFromEnv } from '../src/ai/geminiHttpTransport';

describe('OP-040: GeminiHttpTransport', () => {
  it('calls generateContent with the API key in a header and normalizes the response', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'VENDEDOR_IA_AI_OK' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 7,
        candidatesTokenCount: 3,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-test',
      fetchImpl: fetchImpl as typeof fetch,
    });

    const result = await transport.generate({
      tenantId: 'tenant-a',
      capability: 'FAST_CHAT',
      systemInstructions: 'Return only the marker.',
      input: 'VENDEDOR_IA_AI_OK',
      temperature: 0,
      maxOutputTokens: 32,
    });

    expect(result).toEqual({
      model: 'gemini-test',
      content: 'VENDEDOR_IA_AI_OK',
      inputTokens: 7,
      outputTokens: 3,
      finishReason: 'STOP',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(String(url)).not.toContain('secret-test-key');
    expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-test-key');

    const body = JSON.parse(String(init?.body));
    expect(body.system_instruction.parts[0].text).toBe('Return only the marker.');
    expect(body.generationConfig).toEqual({ temperature: 0, maxOutputTokens: 32 });
  });

  it('checks model reachability without generating content', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-test',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(await transport.healthCheck()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not include provider response details in thrown errors', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'API_KEY=must-never-leak' },
    }), { status: 401 }));

    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-test',
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(transport.generate({
      tenantId: 'tenant-a',
      capability: 'FAST_CHAT',
      input: 'hello',
    })).rejects.not.toThrow(/must-never-leak/);
  });

  it('fails closed when runtime configuration is incomplete', () => {
    expect(createGeminiHttpTransportFromEnv({ GEMINI_API_KEY: 'key-only' })).toBeNull();
    expect(createGeminiHttpTransportFromEnv({ GEMINI_MODEL: 'model-only' })).toBeNull();
  });
});
