import { Request, Response } from 'express';
import {runGeminiOperationalSmoke} from './geminiOperationalSmoke';
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

  const report=await runGeminiOperationalSmoke(tenant.tenantId);
  res.status(200).json({ok:true,data:report});
}
