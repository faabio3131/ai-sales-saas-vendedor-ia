import { describe, expect, it, vi } from 'vitest';
import { evaluateFirebaseRealReadiness } from '../src/operations/firebaseRealReadiness';

describe('firebase real readiness', () => {
  it('reports READY only when project, Auth and Firestore are reachable', async () => {
    const report = await evaluateFirebaseRealReadiness({
      projectConfigured: () => true,
      probeAuth: vi.fn().mockResolvedValue(undefined),
      probeFirestore: vi.fn().mockResolvedValue(undefined),
    });

    expect(report).toEqual({
      status: 'READY',
      projectConfigured: true,
      authReachable: true,
      firestoreReachable: true,
      secretsExposed: false,
    });
  });

  it('fails closed without a configured project', async () => {
    const probeAuth = vi.fn();
    const probeFirestore = vi.fn();
    const report = await evaluateFirebaseRealReadiness({
      projectConfigured: () => false,
      probeAuth,
      probeFirestore,
    });

    expect(report.status).toBe('DEGRADED');
    expect(report.authReachable).toBe(false);
    expect(report.firestoreReachable).toBe(false);
    expect(probeAuth).not.toHaveBeenCalled();
    expect(probeFirestore).not.toHaveBeenCalled();
  });

  it('does not expose provider errors and reports individual failures', async () => {
    const report = await evaluateFirebaseRealReadiness({
      projectConfigured: () => true,
      probeAuth: vi.fn().mockRejectedValue(new Error('sensitive auth details')),
      probeFirestore: vi.fn().mockResolvedValue(undefined),
    });

    expect(report).toEqual({
      status: 'DEGRADED',
      projectConfigured: true,
      authReachable: false,
      firestoreReachable: true,
      secretsExposed: false,
    });
    expect(JSON.stringify(report)).not.toContain('sensitive');
  });
});
