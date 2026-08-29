import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export class AuthClientError extends Error {
  constructor(
    public readonly publicCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthClientError';
  }
}

function env(): Record<string, string | undefined> {
  return (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
}

function buildTimeConfig(): FirebaseClientConfig | null {
  const e = env();
  const apiKey = e.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = e.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = e.VITE_FIREBASE_PROJECT_ID?.trim();
  const appId = e.VITE_FIREBASE_APP_ID?.trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

async function runtimeConfig(): Promise<FirebaseClientConfig> {
  const response = await fetch('/api/runtime/firebase-web', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new AuthClientError('FIREBASE_WEB_CONFIG_UNAVAILABLE', 'Authentication configuration is unavailable.');
  }

  const payload = (await response.json()) as { ok?: boolean; data?: Partial<FirebaseClientConfig> };
  const data = payload.data;
  if (
    !payload.ok ||
    !data?.apiKey ||
    !data.authDomain ||
    !data.projectId ||
    !data.appId
  ) {
    throw new AuthClientError('FIREBASE_WEB_CONFIG_INVALID', 'Authentication configuration is invalid.');
  }

  return {
    apiKey: data.apiKey,
    authDomain: data.authDomain,
    projectId: data.projectId,
    appId: data.appId,
  };
}

async function getClientAuth() {
  if (getApps().length) return getAuth(getApp());
  const config = buildTimeConfig() ?? (await runtimeConfig());
  return getAuth(initializeApp(config));
}

async function establishServerSession(idToken: string): Promise<void> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    throw new AuthClientError('SERVER_SESSION_FAILED', 'Firebase identity was accepted by the client, but the secure server session failed.');
  }
}

function normalizeFirebaseAuthError(error: unknown): never {
  if (error instanceof AuthClientError) throw error;

  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  const safeCodes = new Set([
    'auth/email-already-in-use',
    'auth/invalid-credential',
    'auth/invalid-email',
    'auth/operation-not-allowed',
    'auth/unauthorized-domain',
    'auth/weak-password',
    'auth/network-request-failed',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
  ]);

  throw new AuthClientError(
    safeCodes.has(code) ? code : 'FIREBASE_AUTH_FAILED',
    'Firebase Authentication rejected the request.',
  );
}

export async function loginWithEmail(email: string, password: string): Promise<void> {
  try {
    const credential = await signInWithEmailAndPassword(await getClientAuth(), email, password);
    await establishServerSession(await credential.user.getIdToken());
  } catch (error) {
    normalizeFirebaseAuthError(error);
  }
}

export async function registerWithEmail(email: string, password: string): Promise<void> {
  try {
    const credential = await createUserWithEmailAndPassword(await getClientAuth(), email, password);
    await establishServerSession(await credential.user.getIdToken());
  } catch (error) {
    normalizeFirebaseAuthError(error);
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  try {
    await signOut(await getClientAuth());
  } catch {
    // Server session is the application authority; Firebase client cleanup is best-effort.
  }
}
