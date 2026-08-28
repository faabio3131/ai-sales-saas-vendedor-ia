export interface AuthPrincipal {
  authUserId: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
}

export interface AuthProviderInterface {
  verifyIdToken(idToken: string): Promise<AuthPrincipal>;
}

export interface AppSession {
  principal: AuthPrincipal;
  issuedAt: number;
  expiresAt: number;
}

export interface PublicSession {
  authenticated: true;
  user: AuthPrincipal;
}
