import { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { aiRealSmokeHandler } from '../src/operations/aiRealRoutes';

describe('OP-040: AI operational smoke authorization', () => {
  it('requires an authorized tenant context', async () => {
    await expect(aiRealSmokeHandler({} as Request, {} as Response)).rejects.toMatchObject({
      code: 'AI_SMOKE_TENANT_REQUIRED',
      statusCode: 403,
    });
  });

  it('requires OWNER role before any real provider call can occur', async () => {
    const req = {
      tenantContext: {
        tenantId: 'tenant-a',
        userId: 'user-a',
        role: 'MEMBER',
      },
    } as unknown as Request;

    await expect(aiRealSmokeHandler(req, {} as Response)).rejects.toMatchObject({
      code: 'AI_SMOKE_OWNER_REQUIRED',
      statusCode: 403,
    });
  });
});
