/**
 * Centralized Server Configuration Module.
 * Safely parses and validates runtime environment variables.
 * No real secrets are committed or hardcoded.
 */

export interface ServerConfig {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
  serviceName: string;
  version: string;
  block: string;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = env.PORT ? parseInt(env.PORT, 10) : 3000;
  const nodeEnv = (env.NODE_ENV === 'production' || env.NODE_ENV === 'test') ? env.NODE_ENV : 'development';

  return {
    port: Number.isNaN(port) ? 3000 : port,
    nodeEnv,
    serviceName: 'AI Sales SaaS — Vendedor IA Engine',
    version: '0.1.0',
    block: 'BLK-070',
  };
}

export const serverConfig = loadServerConfig();
