import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { ApplicationError } from '../infrastructure/errors';
import { AuthPrincipal, AuthProviderInterface } from './contracts';

export class FirebaseAuthProvider implements AuthProviderInterface {
  async verifyIdToken(idToken: string): Promise<AuthPrincipal> {
    try {
      if (!getApps().length) {
        const projectId = process.env.FIREBASE_PROJECT_ID;
        initializeApp(projectId ? { projectId } : undefined);
      }

      const decoded = await getAuth().verifyIdToken(idToken, true);
      return {
        authUserId: decoded.uid,
        email: decoded.email,
        displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
        emailVerified: decoded.email_verified,
      };
    } catch {
      throw new ApplicationError({
        category: 'AUTH',
        code: 'INVALID_ID_TOKEN',
        message: 'Authentication failed.',
      });
    }
  }
}
