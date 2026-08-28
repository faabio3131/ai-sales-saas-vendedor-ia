import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Technical Health Check & Foundation status endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      block: 'BLK-000',
      foundation: 'REPOSITORY_GOVERNANCE_FOUNDATION',
      service: 'AI Sales SaaS — Vendedor IA Engine',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      governance: {
        canonicalDocs: '/docs',
        authority: '00_AUTHORITY_AND_EXECUTION_RULES.md',
        multitenancyGuaranteed: true,
        secretsServerSideOnly: true,
      },
    });
  });

  // Vite development middleware or static production serving
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[BLK-000] Foundation Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
