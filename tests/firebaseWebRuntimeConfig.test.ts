import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';
import {
  firebaseWebRuntimeConfigHandler,
  loadFirebaseWebRuntimeConfig,
} from '../src/runtimeConfig/firebaseWeb';

describe('Firebase web runtime configuration', () => {
  it('returns a complete public Firebase web configuration', () => {
    expect(
      loadFirebaseWebRuntimeConfig({
        VITE_FIREBASE_API_KEY: 'public-web-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'example-project',
        VITE_FIREBASE_APP_ID: '1:123:web:abc',
      } as NodeJS.ProcessEnv),
    ).toEqual({
      apiKey: 'public-web-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'example-project',
      appId: '1:123:web:abc',
    });
  });

  it('fails closed when any required value is missing', () => {
    expect(
      loadFirebaseWebRuntimeConfig({
        VITE_FIREBASE_PROJECT_ID: 'example-project',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('returns a sanitized 503 when runtime config is absent', () => {
    const original = process.env;
    process.env = {};
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    firebaseWebRuntimeConfigHandler({} as Request, { status } as unknown as Response);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      ok: false,
      error: {
        code: 'FIREBASE_WEB_NOT_CONFIGURED',
        message: 'Authentication is not configured for this environment.',
      },
    });
    process.env = original;
  });
});
