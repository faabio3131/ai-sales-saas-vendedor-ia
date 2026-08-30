import { Request, Response } from 'express';
import { createRuntimeAIRouter } from '../ai/runtime';
import { ApplicationError } from '../infrastructure/errors';
import { evaluateAIRealReadiness } from './aiRealReadiness';

export async function aiRealReadinessHandler(_req: Request, res: Response): Promise<void> {
  const report = await evaluateAIRealReadiness();
  res.status(report.status === 'READY' ? 200 : 503).json({
    ok: report.status === 'READY',
    data: report,
  });
}

export async function aiRealSmokeHandler(req: Request, res: Response): Promise<void> {
  const tenant = req.tenantContext;
  if (!tenant) {
    throw new ApplicationError({
      category: 'FORBIDDEN',
      code: 'AI_SMOKE_TENANT_REQUIRED',
      message: 'Authorized tenant context is required.',
    });
  }

  if (tenant.role !== 'OWNER') {
    throw new ApplicationError({
      category: 'FORBIDDEN',
      code: 'AI_SMOKE_OWNER_REQUIRED',
      message: 'Owner role is required for AI operational smoke.',
    });
  }

  const router = createRuntimeAIRouter();
  const result = await router.execute({
    tenantId: tenant.tenantId,
    capability: 'FAST_CHAT',
    systemInstructions: 'This is a production provider connectivity smoke test. Follow the requested output exactly.',
    input: 'Return exactly: VENDEDOR_IA_AI_OK',
    maxOutputTokens: 32,
    metadata: {
      purpose: 'OP-040_REAL_AI_SMOKE',
    },
  });

  if (!result.ok || !result.data) {
    throw new ApplicationError({
      category: 'PROVIDER',
      code: result.error?.code || 'AI_SMOKE_FAILED',
      message: 'Real AI provider smoke failed.',
      retryable: result.error?.retryable ?? true,
    });
  }

  res.status(200).json({
    ok: true,
    data: {
      status: 'READY',
      provider: result.data.provider,
      model: result.data.model,
      generated: Boolean(result.data.content?.trim()),
      expectedMarkerObserved: result.data.content?.trim() === 'VENDEDOR_IA_AI_OK',
      latencyMs: result.data.latencyMs,
      inputTokens: result.data.inputTokens,
      outputTokens: result.data.outputTokens,
      secretsExposed: false,
    },
  });
}
