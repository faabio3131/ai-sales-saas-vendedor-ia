import { describe, expect, it } from 'vitest';
import { evaluatePilotReadiness } from '../src/pilot/readiness';

describe('BLK-190 Pilot readiness', () => {
  it('fails closed when required real integrations are not configured', () => {
    const report = evaluatePilotReadiness('tenant-1', { SESSION_SECRET: 'x' });
    expect(report.status).toBe('NO_GO');
    expect(report.checks.find((x) => x.key === 'FIREBASE_PROJECT_ID')?.status).toBe('MISSING');
    expect(report.checks.find((x) => x.key === 'WHATSAPP_REAL_PROVIDER')?.status).toBe('STRUCTURAL_ONLY');
  });

  it('still returns NO_GO with credentials until real owner, deploy, 10 journeys and director approval exist', () => {
    const report = evaluatePilotReadiness('tenant-1', {
      SESSION_SECRET: 'secret-value',
      FIREBASE_PROJECT_ID: 'project',
      WHATSAPP_ACCESS_TOKEN: 'wa-secret',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
      GEMINI_API_KEY: 'ai-secret',
    });
    expect(report.status).toBe('NO_GO');
    expect(report.checks.find(x=>x.key==='T08_1_OWNER_ATTESTED')?.status).toBe('MISSING');
  });

  it('permits GO only when every external certification gate is explicitly supplied by trusted server logic',()=>{
    const report=evaluatePilotReadiness('tenant-1',{
      SESSION_SECRET:'a',FIREBASE_PROJECT_ID:'b',WHATSAPP_ACCESS_TOKEN:'c',
      WHATSAPP_PHONE_NUMBER_ID:'d',GEMINI_API_KEY:'e',
    },{ownerAttested:true,deploymentVerified:true,tenJourneysVerified:true,
      directorGoLiveApproved:true});
    expect(report.status).toBe('GO');
  });

  it('never exposes secret values in the report', () => {
    const env = {
      SESSION_SECRET: 'session-super-secret',
      FIREBASE_PROJECT_ID: 'project',
      WHATSAPP_ACCESS_TOKEN: 'wa-super-secret',
      WHATSAPP_PHONE_NUMBER_ID: 'phone-id',
      OPENAI_API_KEY: 'ai-super-secret',
      PAYMENT_PROVIDER_API_KEY: 'payment-super-secret',
    };
    const serialized = JSON.stringify(evaluatePilotReadiness('tenant-1', env));
    expect(serialized).not.toContain('session-super-secret');
    expect(serialized).not.toContain('wa-super-secret');
    expect(serialized).not.toContain('ai-super-secret');
    expect(serialized).not.toContain('payment-super-secret');
  });
});
