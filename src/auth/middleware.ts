import { NextFunction, Request, Response } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import {sessionSecretFromRuntime} from './runtimeSecret';
import { AuthPrincipal } from './contracts';
import { readSessionCookie, SessionService } from './session';

declare global {
  namespace Express {
    interface Request {
      authPrincipal?: AuthPrincipal;
    }
  }
}

export function createAuthenticationMiddleware(sessionService: SessionService) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const token = readSessionCookie(req.headers.cookie);
      if (!token) {
        throw new ApplicationError({
          category: 'AUTH',
          code: 'SESSION_REQUIRED',
          message: 'Authentication required.',
        });
      }
      req.authPrincipal = sessionService.verify(token).principal;
      next();
    } catch (error) {
      next(error);
    }
  };
}

let defaultSessionService: SessionService | undefined;

export function authenticationMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    defaultSessionService ??= new SessionService(sessionSecretFromRuntime());
    createAuthenticationMiddleware(defaultSessionService)(req, res, next);
  } catch (error) {
    next(error);
  }
}
