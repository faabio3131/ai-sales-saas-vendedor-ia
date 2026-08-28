import { Request, Response, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  return req.tenantContext;
}

export function createChannelsRouter(): Router {
  const router = Router();
  router.get('/', (req: Request, res: Response, next) => {
    try {
      const context = requireContext(req);
      res.status(200).json({
        ok: true,
        data: {
          tenantId: context.tenantId,
          supportedChannels: ['WHATSAPP'],
          liveConnectionConfigured: false,
          note: 'Provider credentials and ChannelConnection provisioning are external configuration, not repository state.',
        },
      });
    } catch (error) { next(error); }
  });
  return router;
}
