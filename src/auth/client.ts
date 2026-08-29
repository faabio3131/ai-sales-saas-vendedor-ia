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
  if (!response.ok) throw new Error('Authentication is not configured for this environment.');

  const payload = (await response.json()) as { ok?: boolean; data?: Partial<FirebaseClientConfig> };
  const data = payload.data;
  if (
    !payload.ok ||
    !data?.apiKey ||
    !data.authDomain ||
    !data.projectId ||
    !data.appId
  ) {
    throw new Error('Authentication is not configured for this environment.');
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
  if (!response.ok) throw new Error('Unable to establish a secure session.');
}

export async function loginWithEmail(email: string, password: string): Promise<void> {
  const credential = await signInWithEmailAndPassword(await getClientAuth(), email, password);
  await establishServerSession(await credential.user.getIdToken());
}

export async function registerWithEmail(email: string, password: string): Promise<void> {
  const credential = await createUserWithEmailAndPassword(await getClientAuth(), email, password);
  await establishServerSession(await credential.user.getIdToken());
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  try {
    await signOut(await getClientAuth());
  } catch {
    // Server session is the application authority; Firebase client cleanup is best-effort.
  }
}
