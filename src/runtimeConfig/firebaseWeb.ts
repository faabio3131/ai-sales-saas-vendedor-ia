import { Request, Response } from 'express';

export interface FirebaseWebRuntimeConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export function loadFirebaseWebRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): FirebaseWebRuntimeConfig | null {
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim();
  const appId = env.VITE_FIREBASE_APP_ID?.trim();

  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

export function firebaseWebRuntimeConfigHandler(_req: Request, res: Response): void {
  const config = loadFirebaseWebRuntimeConfig();
  if (!config) {
    res.status(503).json({
      ok: false,
      error: {
        code: 'FIREBASE_WEB_NOT_CONFIGURED',
        message: 'Authentication is not configured for this environment.',
      },
    });
    return;
  }

  res.status(200).json({ ok: true, data: config });
}
