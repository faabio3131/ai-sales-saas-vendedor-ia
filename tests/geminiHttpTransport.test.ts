import { describe, expect, it, vi } from 'vitest';
import { GeminiHttpTransport, createGeminiHttpTransportFromEnv } from '../src/ai/geminiHttpTransport';

describe('OP-040: GeminiHttpTransport', () => {
  it('calls Interactions API v1 with the API key in a header and normalizes the response', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    let callCount = 0;

    const fetchImpl: typeof fetch = async (input, init) => {
      callCount += 1;
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        model: 'gemini-3.6-flash',
        status: 'completed',
        steps: [{
          type: 'model_output',
          content: [{ type: 'text', text: 'VENDEDOR_IA_AI_OK' }],
        }],
        usage: {
          total_input_tokens: 7,
          total_output_tokens: 3,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-3.6-flash',
      fetchImpl,
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
      model: 'gemini-3.6-flash',
      content: 'VENDEDOR_IA_AI_OK',
      inputTokens: 7,
      outputTokens: 3,
      finishReason: 'completed',
    });

    expect(callCount).toBe(1);
    expect(capturedUrl).toBe('https://generativelanguage.googleapis.com/v1/interactions');
    expect(capturedUrl).not.toContain('secret-test-key');
    expect((capturedInit?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-test-key');

    const body = JSON.parse(String(capturedInit?.body));
    expect(body).toMatchObject({
      model: 'gemini-3.6-flash',
      input: 'VENDEDOR_IA_AI_OK',
      store: false,
      system_instruction: 'Return only the marker.',
      generation_config: { max_output_tokens: 32 },
    });
    expect(body.generation_config).not.toHaveProperty('temperature');
  });

  it('supports output_text when returned directly by the API', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      model: 'gemini-3.6-flash',
      status: 'completed',
      output_text: 'READY',
    }), { status: 200 });

    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-3.6-flash',
      fetchImpl,
    });

    const result = await transport.generate({
      tenantId: 'tenant-a',
      capability: 'FAST_CHAT',
      input: 'ready?',
    });

    expect(result.content).toBe('READY');
  });

  it('checks model reachability without generating content', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }));
    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-3.6-flash',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(await transport.healthCheck()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not include provider response details in thrown errors', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      error: { message: 'API_KEY=must-never-leak' },
    }), { status: 401 });

    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-3.6-flash',
      fetchImpl,
    });

    await expect(transport.generate({
      tenantId: 'tenant-a',
      capability: 'FAST_CHAT',
      input: 'hello',
    })).rejects.not.toThrow(/must-never-leak/);
  });

  it('rejects interaction responses without usable model output', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({
      model: 'gemini-3.6-flash',
      status: 'requires_action',
      steps: [],
    }), { status: 200 });

    const transport = new GeminiHttpTransport({
      apiKey: 'secret-test-key',
      model: 'gemini-3.6-flash',
      fetchImpl,
    });

    await expect(transport.generate({
      tenantId: 'tenant-a',
      capability: 'FAST_CHAT',
      input: 'hello',
    })).rejects.toThrow('Gemini interaction response was invalid.');
  });

  it('fails closed when runtime configuration is incomplete', () => {
    expect(createGeminiHttpTransportFromEnv({ GEMINI_API_KEY: 'key-only' })).toBeNull();
    expect(createGeminiHttpTransportFromEnv({ GEMINI_MODEL: 'model-only' })).toBeNull();
  });
});
