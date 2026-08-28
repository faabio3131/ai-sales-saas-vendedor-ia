import { createHmac, timingSafeEqual } from 'crypto';
import { ApplicationError } from '../infrastructure/errors';
import { AppSession, AuthPrincipal } from './contracts';

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7;

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export class SessionService {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds = DEFAULT_TTL_SECONDS,
  ) {
    if (secret.length < 32) {
      throw new ApplicationError({
        category: 'INTERNAL',
        code: 'SESSION_SECRET_INVALID',
        message: 'Authentication session is not configured.',
        statusCode: 503,
      });
    }
  }

  create(principal: AuthPrincipal, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const session: AppSession = {
      principal,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + this.ttlSeconds,
    };
    const payload = encode(JSON.stringify(session));
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): AppSession {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) {
      throw this.invalidSession();
    }

    const expected = this.sign(payload);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw this.invalidSession();
    }

    let session: AppSession;
    try {
      session = JSON.parse(decode(payload)) as AppSession;
    } catch {
      throw this.invalidSession();
    }

    if (
      !session.principal?.authUserId ||
      !Number.isFinite(session.issuedAt) ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= nowSeconds
    ) {
      throw this.invalidSession();
    }

    return session;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  private invalidSession(): ApplicationError {
    return new ApplicationError({
      category: 'AUTH',
      code: 'INVALID_SESSION',
      message: 'Authentication required.',
    });
  }
}

export const SESSION_COOKIE_NAME = 'vendedor_ia_session';

export function serializeSessionCookie(token: string, production: boolean, maxAgeSeconds = DEFAULT_TTL_SECONDS): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    production ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ].filter(Boolean).join('; ');
}

export function serializeExpiredSessionCookie(production: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    production ? 'Secure' : '',
    'Max-Age=0',
  ].filter(Boolean).join('; ');
}

export function readSessionCookie(cookieHeader?: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return undefined;
}
