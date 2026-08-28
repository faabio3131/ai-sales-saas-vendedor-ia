import { Request, Response } from 'express';
import { serverConfig } from '../../infrastructure/config';

/**
 * Health Check Controller.
 * Simple, fast and zero external dependencies.
 */
export function healthCheckHandler(_req: Request, res: Response): void {
  const memoryUsage = process.memoryUsage();

  res.status(200).json({
    status: 'ok',
    block: serverConfig.block,
    foundation: 'APPLICATION_FOUNDATION',
    service: serverConfig.serviceName,
    version: serverConfig.version,
    environment: serverConfig.nodeEnv,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    governance: {
      canonicalDocs: '/docs',
      authority: '00_AUTHORITY_AND_EXECUTION_RULES.md',
      tenantBoundaryPrepared: true,
      tenantIsolationEnforced: true,
      secretsServerSideOnly: true,
    },
    system: {
      nodeVersion: process.version,
      rssMemoryMb: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
    },
  });
}
