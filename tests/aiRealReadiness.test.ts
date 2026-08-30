import { describe, expect, it, vi } from 'vitest';
import { evaluateAIRealReadiness } from '../src/operations/aiRealReadiness';

describe('OP-040: AI real readiness', () => {
  it('reports READY only when key, model and provider reachability are all present', async () => {
    const report = await evaluateAIRealReadiness({
      env: {
        GEMINI_API_KEY: 'secret-value',
        GEMINI_MODEL: 'gemini-test',
      },
      probeProvider: vi.fn(async () => true),
    });

    expect(report).toMatchObject({
      status: 'READY',
      provider: 'gemini',
      apiKeyConfigured: true,
      modelConfigured: true,
      model: 'gemini-test',
      providerReachable: true,
      secretsExposed: false,
    });
    expect(JSON.stringify(report)).not.toContain('secret-value');
  });

  it('reports DEGRADED without invoking the provider when configuration is incomplete', async () => {
    const probeProvider = vi.fn(async () => true);
    const report = await evaluateAIRealReadiness({
      env: { GEMINI_API_KEY: 'secret-value' },
      probeProvider,
    });

    expect(report.status).toBe('DEGRADED');
    expect(report.modelConfigured).toBe(false);
    expect(report.providerReachable).toBe(false);
    expect(probeProvider).not.toHaveBeenCalled();
  });

  it('reports DEGRADED when provider probing fails and sanitizes the failure', async () => {
    const report = await evaluateAIRealReadiness({
      env: {
        GEMINI_API_KEY: 'secret-value',
        GEMINI_MODEL: 'gemini-test',
      },
      probeProvider: vi.fn(async () => {
        throw new Error('provider secret detail');
      }),
    });

    expect(report.status).toBe('DEGRADED');
    expect(report.providerReachable).toBe(false);
    expect(JSON.stringify(report)).not.toContain('provider secret detail');
    expect(JSON.stringify(report)).not.toContain('secret-value');
  });
});
