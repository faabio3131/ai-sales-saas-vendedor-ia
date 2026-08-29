import { Request, Router } from 'express';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreSubscriptionRepository, FirestoreUsageRepository } from './firestoreRepository';
import { FeatureEntitlementService, UsageService } from './service';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category:'FORBIDDEN', code:'TENANT_CONTEXT_REQUIRED', message:'Tenant context is required.' });
  return req.tenantContext;
}

export function createPlansRouter(): Router {
  const router = Router();
  const subscriptions = new FirestoreSubscriptionRepository();
  const entitlements = new FeatureEntitlementService(subscriptions);
  const usage = new UsageService(new FirestoreUsageRepository(), entitlements);

  router.get('/plan', async (req, res, next) => { try { res.status(200).json({ ok:true, data:await entitlements.getPlan(requireContext(req).tenantId) }); } catch (e) { next(e); } });
  router.get('/limits', async (req, res, next) => { try { res.status(200).json({ ok:true, data:await entitlements.getLimits(requireContext(req).tenantId) }); } catch (e) { next(e); } });
  router.get('/features/:feature', async (req, res, next) => { try { res.status(200).json({ ok:true, data:{ allowed:await entitlements.canUse(requireContext(req).tenantId, req.params.feature as never) } }); } catch (e) { next(e); } });
  router.get('/usage/:periodKey/:metric', async (req, res, next) => { try { res.status(200).json({ ok:true, data:await usage.get(requireContext(req).tenantId, req.params.metric, req.params.periodKey) }); } catch (e) { next(e); } });
  return router;
}
