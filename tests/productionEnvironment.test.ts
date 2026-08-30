import { describe, expect, it } from 'vitest';
import { validateProductionEnvironment } from '../src/operations/productionEnvironment';

describe('OP-010 Production Environment', () => {
  it('accepts a minimum valid production contract', () => {
    const report = validateProductionEnvironment({
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      FIREBASE_PROJECT_ID: 'real-project-id',
      PUBLIC_APP_URL: 'https://app.example.com',
    });
    expect(report.valid).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('rejects missing, weak or insecure critical configuration', () => {
    const report = validateProductionEnvironment({
      SESSION_SECRET: 'short',
      PUBLIC_APP_URL: 'http://app.example.com',
    });
    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['REQUIRED', 'TOO_SHORT', 'HTTPS_REQUIRED']));
  });

  it('rejects partial Gemini real-provider configuration', () => {
    const report = validateProductionEnvironment({
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      FIREBASE_PROJECT_ID: 'real-project-id',
      PUBLIC_APP_URL: 'https://app.example.com',
      GEMINI_API_KEY: 'secret-gemini-key',
    });
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ key: 'GEMINI_REAL_PROVIDER', code: 'PARTIAL_CONFIGURATION' }));
    expect(JSON.stringify(report)).not.toContain('secret-gemini-key');
  });

  it('accepts paired Gemini configuration without exposing it', () => {
    const report = validateProductionEnvironment({
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      FIREBASE_PROJECT_ID: 'real-project-id',
      PUBLIC_APP_URL: 'https://app.example.com',
      GEMINI_API_KEY: 'secret-gemini-key',
      GEMINI_MODEL: 'gemini-test',
    });
    expect(report.valid).toBe(true);
    expect(JSON.stringify(report)).not.toContain('secret-gemini-key');
  });

  it('rejects partial WhatsApp real-provider configuration', () => {
    const report = validateProductionEnvironment({
      SESSION_SECRET: '0123456789abcdef0123456789abcdef',
      FIREBASE_PROJECT_ID: 'real-project-id',
      PUBLIC_APP_URL: 'https://app.example.com',
      WHATSAPP_ACCESS_TOKEN: 'secret-token',
    });
    expect(report.valid).toBe(false);
    expect(report.issues).toContainEqual(expect.objectContaining({ key: 'WHATSAPP_REAL_PROVIDER', code: 'PARTIAL_CONFIGURATION' }));
    expect(JSON.stringify(report)).not.toContain('secret-token');
  });
});
