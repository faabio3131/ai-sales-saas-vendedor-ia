import { getAuth } from 'firebase-admin/auth';
import { ApplicationError } from '../infrastructure/errors';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { AuthPrincipal, AuthProviderInterface } from './contracts';

export class FirebaseAuthProvider implements AuthProviderInterface {
  async verifyIdToken(idToken: string): Promise<AuthPrincipal> {
    try {
      const app = ensureFirebaseAdminApp();
      const decoded = await getAuth(app).verifyIdToken(idToken, true);
      return {
        authUserId: decoded.uid,
        email: decoded.email,
        displayName: typeof decoded.name === 'string' ? decoded.name : undefined,
        emailVerified: decoded.email_verified,
      };
    } catch (error) {
      if (error instanceof ApplicationError && error.code === 'FIREBASE_NOT_CONFIGURED') throw error;
      throw new ApplicationError({
        category: 'AUTH',
        code: 'INVALID_ID_TOKEN',
        message: 'Authentication failed.',
      });
    }
  }
}
