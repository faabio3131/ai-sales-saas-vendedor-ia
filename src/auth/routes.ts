import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import {sessionSecretFromRuntime} from './runtimeSecret';
import { AuthProviderInterface } from './contracts';
import { FirebaseAuthProvider } from './firebaseProvider';
import {
  readSessionCookie,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  SessionService,
} from './session';

export interface AuthDependencies {
  provider: AuthProviderInterface;
  sessionService: SessionService;
  production: boolean;
}

function defaultDependencies(): AuthDependencies {
  const secret = sessionSecretFromRuntime();
  return {
    provider: new FirebaseAuthProvider(),
    sessionService: new SessionService(secret),
    production: process.env.NODE_ENV === 'production',
  };
}

export function buildAuthHandlers(deps: AuthDependencies) {
  return {
    createSession: async (req: Request, res: Response): Promise<void> => {
      const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
      if (!idToken) {
        throw new ApplicationError({
          category: 'VALIDATION',
          code: 'ID_TOKEN_REQUIRED',
          message: 'Authentication token is required.',
        });
      }

      const principal = await deps.provider.verifyIdToken(idToken);
      const token = deps.sessionService.create(principal);
      res.setHeader('Set-Cookie', serializeSessionCookie(token, deps.production));
      res.status(200).json({
        ok: true,
        data: {
          authenticated: true,
          user: principal,
        },
      });
    },

    getSession: async (req: Request, res: Response): Promise<void> => {
      const token = readSessionCookie(req.headers.cookie);
      if (!token) {
        throw new ApplicationError({
          category: 'AUTH',
          code: 'SESSION_REQUIRED',
          message: 'Authentication required.',
        });
      }

      const session = deps.sessionService.verify(token);
      res.status(200).json({
        ok: true,
        data: {
          authenticated: true,
          user: session.principal,
        },
      });
    },

    deleteSession: async (_req: Request, res: Response): Promise<void> => {
      res.setHeader('Set-Cookie', serializeExpiredSessionCookie(deps.production));
      res.status(204).send();
    },
  };
}

export function createAuthRouter(deps?: AuthDependencies): Router {
  const router = Router();
  let resolved: AuthDependencies | undefined = deps;
  const getHandlers = () => {
    resolved ??= defaultDependencies();
    return buildAuthHandlers(resolved);
  };

  router.post('/session', (req, res, next) => {
    getHandlers().createSession(req, res).catch(next);
  });
  router.get('/session', (req, res, next) => {
    getHandlers().getSession(req, res).catch(next);
  });
  router.delete('/session', (req, res, next) => {
    getHandlers().deleteSession(req, res).catch(next);
  });

  return router;
}
