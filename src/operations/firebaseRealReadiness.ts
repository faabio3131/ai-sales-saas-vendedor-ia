import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';

export interface FirebaseRealReadinessReport {
  status: 'READY' | 'DEGRADED';
  projectConfigured: boolean;
  authReachable: boolean;
  firestoreReachable: boolean;
  secretsExposed: false;
}

export interface FirebaseRealReadinessDependencies {
  projectConfigured: () => boolean;
  probeAuth: () => Promise<void>;
  probeFirestore: () => Promise<void>;
}

function defaultDependencies(): FirebaseRealReadinessDependencies {
  return {
    projectConfigured: () => Boolean(process.env.FIREBASE_PROJECT_ID?.trim()),
    probeAuth: async () => {
      const app = ensureFirebaseAdminApp();
      await getAuth(app).listUsers(1);
    },
    probeFirestore: async () => {
      const app = ensureFirebaseAdminApp();
      await getFirestore(app).listCollections();
    },
  };
}

export async function evaluateFirebaseRealReadiness(
  deps: FirebaseRealReadinessDependencies = defaultDependencies(),
): Promise<FirebaseRealReadinessReport> {
  const projectConfigured = deps.projectConfigured();
  let authReachable = false;
  let firestoreReachable = false;

  if (projectConfigured) {
    try {
      await deps.probeAuth();
      authReachable = true;
    } catch {
      authReachable = false;
    }

    try {
      await deps.probeFirestore();
      firestoreReachable = true;
    } catch {
      firestoreReachable = false;
    }
  }

  return {
    status: projectConfigured && authReachable && firestoreReachable ? 'READY' : 'DEGRADED',
    projectConfigured,
    authReachable,
    firestoreReachable,
    secretsExposed: false,
  };
}
