import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './src/api/router';
import { errorHandler } from './src/api/middleware/errorHandler';
import { serverConfig } from './src/infrastructure/config';

export async function createApp() {
  const app = express();

  app.use(express.json());

  // Mount central API router
  app.use('/api', createApiRouter());

  // Error handling middleware for API routes
  app.use(errorHandler);

  // Vite development middleware or static production serving
  if (serverConfig.nodeEnv !== 'production') {
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

  return app;
}

export async function startServer() {
  const app = await createApp();
  const PORT = serverConfig.port;

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[${serverConfig.block}] Application Foundation Server running on http://0.0.0.0:${PORT}`);
  });

  return server;
}

// Auto-start when executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer();
}
