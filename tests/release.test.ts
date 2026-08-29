import { describe, expect, it } from 'vitest';
import { evaluateCommercialReleaseReadiness } from '../src/release/readiness';

describe('BLK-200 Commercial Release readiness', () => {
  it('fails closed without real commercial evidence', () => {
    const report = evaluateCommercialReleaseReadiness('tenant-1', {});
    expect(report.status).toBe('NO_GO');
    expect(report.requiresHumanApproval).toBe(true);
    expect(report.checks.find((c) => c.key === 'PILOT_VALIDATED')?.status).toBe('MISSING');
  });

  it('does not expose secret values and marks structural providers when missing', () => {
    const report = evaluateCommercialReleaseReadiness('tenant-1', { SESSION_SECRET: 'super-secret-value' });
    expect(JSON.stringify(report)).not.toContain('super-secret-value');
    expect(report.checks.find((c) => c.key === 'AI_REAL_PROVIDER')?.status).toBe('STRUCTURAL_ONLY');
    expect(report.checks.find((c) => c.key === 'WHATSAPP_REAL_PROVIDER')?.status).toBe('STRUCTURAL_ONLY');
  });

  it('returns GO only when every required commercial gate is explicitly satisfied', () => {
    const report = evaluateCommercialReleaseReadiness('tenant-1', {
      PILOT_VALIDATED: 'true',
      SESSION_SECRET: 'secret',
      FIREBASE_PROJECT_ID: 'project',
      GEMINI_API_KEY: 'ai-key',
      WHATSAPP_ACCESS_TOKEN: 'wa-token',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
      COMMERCIAL_BILLING_ENABLED: 'true',
      PAYMENT_PROVIDER_API_KEY: 'payment-key',
      PRODUCTION_MONITORING_ENABLED: 'true',
      LEGAL_DOCS_APPROVED: 'true',
      PUBLIC_APP_URL: 'https://app.example.test',
      ROLLBACK_PLAN_APPROVED: 'true',
    });
    expect(report.status).toBe('GO');
    expect(report.checks.every((c) => !c.required || c.status === 'READY')).toBe(true);
  });
});
