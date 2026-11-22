import { ApplicationError } from '../infrastructure/errors';

export type PilotLiveFeature = 'ONLINE_PAYMENT_CREATE' | 'PSP_REFUND' | 'WHATSAPP_OUTBOUND';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Test doubles are isolated by NODE_ENV=test. All other environments deny by default. */
export function pilotLiveFeatureEnabled(
  feature: PilotLiveFeature,
  tenantId: string,
  unitId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.NODE_ENV === 'test') return true;
  if (env.ATENDEVENDE_PILOT_LIVE_ENABLED !== 'true' ||
      env.ATENDEVENDE_PILOT_GO_LIVE_APPROVED !== 'true') return false;
  if (!unitId || !ID.test(tenantId) || !ID.test(unitId)) return false;
  const raw = env.ATENDEVENDE_PILOT_ALLOWED_UNITS;
  if (!raw || raw.length > 16384) return false;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const tenant = (data as Record<string, unknown>)[tenantId];
    if (!tenant || typeof tenant !== 'object' || Array.isArray(tenant)) return false;
    const allowed = (tenant as Record<string, unknown>)[unitId];
    return Array.isArray(allowed) && allowed.length <= 8 &&
      allowed.every((value: unknown) => value === 'ONLINE_PAYMENT_CREATE' || value === 'PSP_REFUND' || value === 'WHATSAPP_OUTBOUND') &&
      allowed.includes(feature);
  } catch { return false; }
}
export function requirePilotLiveFeature(
  feature: PilotLiveFeature,
  tenantId: string,
  unitId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!pilotLiveFeatureEnabled(feature, tenantId, unitId, env)) {
    throw new ApplicationError({
      category: 'FORBIDDEN', code: 'PILOT_FEATURE_DISABLED',
      message: 'Live operations are disabled for this business unit.',
    });
  }
}
