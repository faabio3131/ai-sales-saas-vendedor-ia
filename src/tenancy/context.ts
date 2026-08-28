import { TenantContext } from '../types/contracts';

/**
 * Validates whether a TenantContext has the minimal required identifiers.
 */
export function isValidTenantContext(context: unknown): context is TenantContext {
  if (!context || typeof context !== 'object') {
    return false;
  }
  const ctx = context as Record<string, unknown>;
  return (
    typeof ctx.tenantId === 'string' &&
    ctx.tenantId.trim().length > 0 &&
    typeof ctx.requestId === 'string' &&
    ctx.requestId.trim().length > 0
  );
}

/**
 * Creates a standard TenantContext object for use across application boundaries.
 */
export function createTenantContext(params: {
  tenantId: string;
  userId?: string;
  role?: string;
  requestId?: string;
  correlationId?: string;
}): TenantContext {
  return {
    tenantId: params.tenantId.trim(),
    userId: params.userId?.trim(),
    role: params.role?.trim(),
    requestId: params.requestId?.trim() || `req_${Date.now()}`,
    correlationId: params.correlationId?.trim(),
  };
}
