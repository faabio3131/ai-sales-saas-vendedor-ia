import { describe, it, expect } from 'vitest';
import { TenantContext, Result } from '../src/types/contracts';

describe('BLK-000: Repository & Governance Foundation Tests', () => {
  it('should enforce TenantContext type structure with mandatory tenantId and requestId', () => {
    const context: TenantContext = {
      tenantId: 'tenant-test-123',
      requestId: 'req-abc-789',
      userId: 'user-001',
      role: 'ADMIN',
    };

    expect(context.tenantId).toBe('tenant-test-123');
    expect(context.requestId).toBe('req-abc-789');
    expect(context.userId).toBe('user-001');
    expect(context.role).toBe('ADMIN');
  });

  it('should format typed Result objects correctly for success and error states', () => {
    const successResult: Result<{ ready: boolean }> = {
      ok: true,
      data: { ready: true },
    };

    const errorResult: Result<never> = {
      ok: false,
      error: {
        category: 'VALIDATION',
        code: 'MISSING_FIELD',
        message: 'O campo tenantId é obrigatório.',
        retryable: false,
      },
    };

    expect(successResult.ok).toBe(true);
    expect(successResult.data?.ready).toBe(true);

    expect(errorResult.ok).toBe(false);
    expect(errorResult.error?.category).toBe('VALIDATION');
    expect(errorResult.error?.code).toBe('MISSING_FIELD');
  });

  it('should verify that all canonical governance docs are intact in /docs', () => {
    const canonicalDocFiles = [
      '00_AUTHORITY_AND_EXECUTION_RULES.md',
      'MASTER.md',
      'ARCHITECTURE.md',
      'SYSTEM_DESIGN.md',
      'REQUIREMENTS.md',
      'TECHNICAL_CONTRACTS.md',
      'DATA_MODEL.md',
      'IMPLEMENTATION_PLAN.md',
      'AI_STUDIO_EXECUTION_PROTOCOL.md',
    ];

    expect(canonicalDocFiles.length).toBe(9);
    expect(canonicalDocFiles[0]).toBe('00_AUTHORITY_AND_EXECUTION_RULES.md');
  });
});
