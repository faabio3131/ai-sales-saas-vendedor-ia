import { describe, expect, it, vi } from 'vitest';
import { Request, Response } from 'express';
import { AuthProviderInterface } from '../src/auth/contracts';
import { buildAuthHandlers } from '../src/auth/routes';
import {
  readSessionCookie,
  serializeSessionCookie,
  SessionService,
} from '../src/auth/session';

const SECRET = '0123456789abcdef0123456789abcdef';

function responseMock() {
  const json = vi.fn();
  const send = vi.fn();
  const setHeader = vi.fn();
  const status = vi.fn(() => ({ json, send }));
  return {
    res: { status, json, send, setHeader } as unknown as Response,
    status,
    json,
    send,
    setHeader,
  };
}

describe('BLK-020: Authentication', () => {
  it('creates and verifies a signed provider-neutral session', () => {
    const service = new SessionService(SECRET, 60);
    const token = service.create({ authUserId: 'firebase-user-1', email: 'user@example.com' }, 1000);
    const session = service.verify(token, 1050);
    expect(session.principal.authUserId).toBe('firebase-user-1');
    expect(session.principal.email).toBe('user@example.com');
    expect(session.expiresAt).toBe(1060);
  });

  it('rejects a tampered or expired session', () => {
    const service = new SessionService(SECRET, 10);
    const token = service.create({ authUserId: 'user-1' }, 1000);
    expect(() => service.verify(`${token}tampered`, 1001)).toThrow('Authentication required.');
    expect(() => service.verify(token, 1010)).toThrow('Authentication required.');
  });

  it('uses secure HttpOnly cookie attributes in production', () => {
    const cookie = serializeSessionCookie('signed-token', true, 3600);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=3600');
    expect(readSessionCookie(cookie)).toBe('signed-token');
  });

  it('creates application session only from provider-verified identity', async () => {
    const provider: AuthProviderInterface = {
      verifyIdToken: vi.fn(async (token: string) => {
        expect(token).toBe('external-id-token');
        return { authUserId: 'verified-user', email: 'verified@example.com' };
      }),
    };
    const service = new SessionService(SECRET, 60);
    const handlers = buildAuthHandlers({ provider, sessionService: service, production: true });
    const { res, status, json, setHeader } = responseMock();

    await handlers.createSession(
      { body: { idToken: 'external-id-token', authUserId: 'attacker-controlled' } } as unknown as Request,
      res,
    );

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      ok: true,
      data: {
        authenticated: true,
        user: { authUserId: 'verified-user', email: 'verified@example.com' },
      },
    });
    const cookie = setHeader.mock.calls[0][1] as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    const token = readSessionCookie(cookie);
    expect(token).toBeTruthy();
    expect(service.verify(token!).principal.authUserId).toBe('verified-user');
  });

  it('returns an authenticated session from a valid cookie and clears it on logout', async () => {
    const provider: AuthProviderInterface = { verifyIdToken: vi.fn() };
    const service = new SessionService(SECRET, 60);
    const handlers = buildAuthHandlers({ provider, sessionService: service, production: false });
    const token = service.create({ authUserId: 'user-2' });

    const current = responseMock();
    await handlers.getSession(
      { headers: { cookie: `vendedor_ia_session=${encodeURIComponent(token)}` } } as Request,
      current.res,
    );
    expect(current.status).toHaveBeenCalledWith(200);
    expect(current.json.mock.calls[0][0].data.user.authUserId).toBe('user-2');

    const loggedOut = responseMock();
    await handlers.deleteSession({} as Request, loggedOut.res);
    expect(loggedOut.status).toHaveBeenCalledWith(204);
    expect(loggedOut.setHeader.mock.calls[0][1]).toContain('Max-Age=0');
  });

  it('requires a strong server-side session secret', () => {
    expect(() => new SessionService('short')).toThrow('Authentication session is not configured.');
  });
});
