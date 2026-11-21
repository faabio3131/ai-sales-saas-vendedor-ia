import express, { Request, Response } from 'express';
import path from 'path';
import { createApiRouter } from './src/api/router';
import { errorHandler } from './src/api/middleware/errorHandler';
import { createRateLimiter, requestContext, securityHeaders } from './src/api/middleware/hardening';
import { serverConfig } from './src/infrastructure/config';

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(requestContext);
  app.use(createRateLimiter());
  app.use(express.json({ limit: '256kb', verify:(req,_res,buffer)=>{
    if(req.originalUrl.startsWith('/api/payments/webhooks/')){
      (req as typeof req&{paymentRawBody?:Buffer}).paymentRawBody=Buffer.from(buffer);
    }
  }}));
  app.use('/api', createApiRouter());
  app.use(errorHandler);

  if (serverConfig.nodeEnv !== 'production') {
    // Vite is a development-only dependency. Load it lazily so the production
    // runtime image (npm install --omit=dev) never attempts to resolve it.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => { res.sendFile(path.join(distPath, 'index.html')); });
  }
  return app;
}

export async function startServer() {
  const app = await createApp();
  const server = app.listen(serverConfig.port, '0.0.0.0', () => {
    console.log(`[${serverConfig.block}] Vendedor IA server listening on port ${serverConfig.port}`);
  });
  return server;
}

if (process.env.NODE_ENV !== 'test') startServer();
