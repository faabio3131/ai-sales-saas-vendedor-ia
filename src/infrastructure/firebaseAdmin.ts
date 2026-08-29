import { App, applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { ApplicationError } from './errors';

export function getFirebaseProjectId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.FIREBASE_PROJECT_ID?.trim();
  return value || undefined;
}

export function ensureFirebaseAdminApp(env: NodeJS.ProcessEnv = process.env): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = getFirebaseProjectId(env);
  if (env.NODE_ENV === 'production' && !projectId) {
    throw new ApplicationError({
      category: 'INTERNAL',
      code: 'FIREBASE_NOT_CONFIGURED',
      message: 'Firebase is not configured for this environment.',
      statusCode: 503,
      retryable: false,
    });
  }

  return initializeApp({
    ...(projectId ? { projectId } : {}),
    credential: applicationDefault(),
  });
}

export function describeFirebaseAdminReadiness(env: NodeJS.ProcessEnv = process.env) {
  const projectId = getFirebaseProjectId(env);
  return {
    configured: Boolean(projectId),
    projectIdConfigured: Boolean(projectId),
    credentialStrategy: 'APPLICATION_DEFAULT_CREDENTIALS' as const,
    secretsExposed: false as const,
  };
}
