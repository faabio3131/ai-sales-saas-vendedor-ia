import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

function env(): Record<string, string | undefined> {
  return (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env;
}

function getClientAuth() {
  const e = env();
  const config = {
    apiKey: e.VITE_FIREBASE_API_KEY,
    authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: e.VITE_FIREBASE_PROJECT_ID,
    appId: e.VITE_FIREBASE_APP_ID,
  };

  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    throw new Error('Authentication is not configured for this environment.');
  }

  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
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
  const credential = await signInWithEmailAndPassword(getClientAuth(), email, password);
  await establishServerSession(await credential.user.getIdToken());
}

export async function registerWithEmail(email: string, password: string): Promise<void> {
  const credential = await createUserWithEmailAndPassword(getClientAuth(), email, password);
  await establishServerSession(await credential.user.getIdToken());
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  try {
    await signOut(getClientAuth());
  } catch {
    // Server session is the application authority; Firebase client cleanup is best-effort.
  }
}
