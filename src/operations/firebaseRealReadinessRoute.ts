import { Request, Response } from 'express';
import { evaluateFirebaseRealReadiness } from './firebaseRealReadiness';

export async function firebaseRealReadinessHandler(_req: Request, res: Response): Promise<void> {
  const report = await evaluateFirebaseRealReadiness();
  res.status(report.status === 'READY' ? 200 : 503).json({
    ok: report.status === 'READY',
    data: report,
  });
}
