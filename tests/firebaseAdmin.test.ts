import { describe, expect, it } from 'vitest';
import { describeFirebaseAdminReadiness, getFirebaseProjectId } from '../src/infrastructure/firebaseAdmin';

describe('Firebase Admin operational readiness', () => {
  it('normalizes the configured project id without exposing credentials', () => {
    const env = { FIREBASE_PROJECT_ID: '  vendedor-ia-prod  ' } as NodeJS.ProcessEnv;
    expect(getFirebaseProjectId(env)).toBe('vendedor-ia-prod');
    expect(describeFirebaseAdminReadiness(env)).toEqual({
      configured: true,
      projectIdConfigured: true,
      credentialStrategy: 'APPLICATION_DEFAULT_CREDENTIALS',
      secretsExposed: false,
    });
  });

  it('reports missing Firebase project without inventing readiness', () => {
    const report = describeFirebaseAdminReadiness({} as NodeJS.ProcessEnv);
    expect(report.configured).toBe(false);
    expect(report.projectIdConfigured).toBe(false);
    expect(report.secretsExposed).toBe(false);
  });
});
