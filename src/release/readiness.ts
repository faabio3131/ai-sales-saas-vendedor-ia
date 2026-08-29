export type ReleaseCheckStatus = 'READY' | 'MISSING' | 'STRUCTURAL_ONLY';

export interface ReleaseReadinessCheck {
  key: string;
  required: boolean;
  status: ReleaseCheckStatus;
  note: string;
}

export interface ReleaseReadinessReport {
  tenantId: string;
  status: 'GO' | 'NO_GO';
  requiresHumanApproval: true;
  checks: ReleaseReadinessCheck[];
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function evaluateCommercialReleaseReadiness(tenantId: string, env: NodeJS.ProcessEnv = process.env): ReleaseReadinessReport {
  const has = (key: string) => Boolean(env[key]?.trim());
  const checks: ReleaseReadinessCheck[] = [
    { key: 'PILOT_VALIDATED', required: true, status: enabled(env.PILOT_VALIDATED) ? 'READY' : 'MISSING', note: 'A real controlled pilot must be validated before commercial release.' },
    { key: 'SESSION_SECRET', required: true, status: has('SESSION_SECRET') ? 'READY' : 'MISSING', note: 'Production-grade server-side session signing must be configured.' },
    { key: 'FIREBASE_PROJECT_ID', required: true, status: has('FIREBASE_PROJECT_ID') ? 'READY' : 'MISSING', note: 'Real Firebase project must be configured for auth/persistence.' },
    { key: 'AI_REAL_PROVIDER', required: true, status: has('GEMINI_API_KEY') || has('OPENAI_API_KEY') || has('ANTHROPIC_API_KEY') ? 'READY' : 'STRUCTURAL_ONLY', note: 'At least one approved real AI provider must be configured.' },
    { key: 'WHATSAPP_REAL_PROVIDER', required: true, status: has('WHATSAPP_ACCESS_TOKEN') && has('WHATSAPP_PHONE_NUMBER_ID') ? 'READY' : 'STRUCTURAL_ONLY', note: 'Real WhatsApp credentials must be configured and validated.' },
    { key: 'COMMERCIAL_BILLING', required: true, status: enabled(env.COMMERCIAL_BILLING_ENABLED) && has('PAYMENT_PROVIDER_API_KEY') ? 'READY' : 'STRUCTURAL_ONLY', note: 'Paid commercial release requires a real billing/payment provider path.' },
    { key: 'MONITORING', required: true, status: enabled(env.PRODUCTION_MONITORING_ENABLED) ? 'READY' : 'MISSING', note: 'Production monitoring and alerting must be enabled.' },
    { key: 'LEGAL_DOCS', required: true, status: enabled(env.LEGAL_DOCS_APPROVED) ? 'READY' : 'MISSING', note: 'Terms, privacy and commercial legal documents must be approved.' },
    { key: 'PRODUCTION_URL', required: true, status: has('PUBLIC_APP_URL') ? 'READY' : 'MISSING', note: 'A production application URL must be configured.' },
    { key: 'ROLLBACK_APPROVED', required: true, status: enabled(env.ROLLBACK_PLAN_APPROVED) ? 'READY' : 'MISSING', note: 'Rollback procedure must be reviewed and approved before rollout.' },
  ];
  const ready = checks.filter((check) => check.required).every((check) => check.status === 'READY');
  return { tenantId, status: ready ? 'GO' : 'NO_GO', requiresHumanApproval: true, checks };
}
