import { Router } from 'express';
import { authenticationMiddleware } from '../auth/middleware';
import { createAuthRouter } from '../auth/routes';
import { createCatalogRouter } from '../catalog/routes';
import { createCommerceRouter } from '../commerce/routes';
import { createOrdersRouter } from '../orders/routes';
import { createBusinessRouter } from '../business/routes';
import { createChannelsRouter } from '../channels/routes';
import { createConversationRouter } from '../conversations/routes';
import { createCustomersRouter } from '../customers/routes';
import { createDashboardRouter } from '../dashboard/routes';
import {createFinanceRouter} from '../finance/routes';
import { createFollowUpsRouter } from '../followups/routes';
import { createLeadsRouter } from '../leads/routes';
import { aiRealReadinessHandler, aiRealSmokeHandler } from '../operations/aiRealRoutes';
import { firebaseRealReadinessHandler } from '../operations/firebaseRealReadinessRoute';
import { createPaymentsRouter } from '../payments/routes';
import { createOrderPaymentsRouter } from '../orderPayments/routes';
import {createFulfillmentRouter} from '../fulfillment/routes';
import { mercadoPagoWebhookHandler } from '../payments/webhook';
import {PaymentWebhookProcessor,handleBankWebhook} from '../payments/providerWebhooks';
import {createBankPaymentRuntime} from '../payments/bankRuntime';
import { createPilotRouter } from '../pilot/routes';
import {createEstablishmentSettingsRouter} from '../establishments/routes';
import { createPlansRouter } from '../plans/routes';
import { createQuotesRouter } from '../quotes/routes';
import { createRecoveryRouter } from '../recovery/routes';
import { createReleaseRouter } from '../release/routes';
import { createRevenueExpansionRouter } from '../revenueExpansion/routes';
import { firebaseWebRuntimeConfigHandler } from '../runtimeConfig/firebaseWeb';
import { createSalesRouter } from '../sales/routes';
import { createGovernanceRouter } from '../governance/routes';
import { tenantAuthorizationMiddleware } from '../tenancy/middleware';
import { activeTenantMembershipsHandler, createTenancyRouter } from '../tenancy/routes';
import { healthCheckHandler } from './routes/health';

export function createApiRouter(): Router {
  const router = Router();
  router.use('/auth', createAuthRouter());
  router.get('/health', healthCheckHandler);
  router.get('/runtime/firebase-web', firebaseWebRuntimeConfigHandler);
  router.get('/operations/firebase-readiness', (req, res, next) => {
    firebaseRealReadinessHandler(req, res).catch(next);
  });
  router.get('/operations/ai-readiness', authenticationMiddleware, tenantAuthorizationMiddleware, (req, res, next) => {
    aiRealReadinessHandler(req, res).catch(next);
  });
  router.post('/operations/ai-smoke', authenticationMiddleware, tenantAuthorizationMiddleware, (req, res, next) => {
    aiRealSmokeHandler(req, res).catch(next);
  });
  router.get('/tenancy/memberships', authenticationMiddleware, (req, res, next) => {
    activeTenantMembershipsHandler(req, res).catch(next);
  });
  router.use('/tenancy', authenticationMiddleware, tenantAuthorizationMiddleware, createTenancyRouter());
  router.use('/catalog', authenticationMiddleware, tenantAuthorizationMiddleware, createCatalogRouter());
  router.use('/commerce', authenticationMiddleware, tenantAuthorizationMiddleware, createCommerceRouter());
  router.use('/orders', authenticationMiddleware, tenantAuthorizationMiddleware, createOrdersRouter());
  router.use('/business', authenticationMiddleware, tenantAuthorizationMiddleware, createBusinessRouter());
  router.use('/customers', authenticationMiddleware, tenantAuthorizationMiddleware, createCustomersRouter());
  router.use('/conversations', authenticationMiddleware, tenantAuthorizationMiddleware, createConversationRouter());
  router.use('/leads', authenticationMiddleware, tenantAuthorizationMiddleware, createLeadsRouter());
  router.use('/sales', authenticationMiddleware, tenantAuthorizationMiddleware, createSalesRouter());
  router.use('/autonomy', authenticationMiddleware, tenantAuthorizationMiddleware, createGovernanceRouter());
  router.use('/followups', authenticationMiddleware, tenantAuthorizationMiddleware, createFollowUpsRouter());
  router.use('/recovery', authenticationMiddleware, tenantAuthorizationMiddleware, createRecoveryRouter());
  router.use('/channels', authenticationMiddleware, tenantAuthorizationMiddleware, createChannelsRouter());
  router.use('/dashboard', authenticationMiddleware, tenantAuthorizationMiddleware, createDashboardRouter());
  router.use('/finance',authenticationMiddleware,tenantAuthorizationMiddleware,createFinanceRouter());
  router.use('/quotes', authenticationMiddleware, tenantAuthorizationMiddleware, createQuotesRouter());
  router.post('/payments/webhooks/mercadopago', (req,res,next) => {
    mercadoPagoWebhookHandler(req,res).catch(next);
  });
  router.post('/payments/webhooks/:provider/:tenantId', (req,res,next)=>{
    const runtime=createBankPaymentRuntime();
    const processor=new PaymentWebhookProcessor(runtime);
    handleBankWebhook(req,res,processor).catch(next);
  });
  router.use('/payments', authenticationMiddleware, tenantAuthorizationMiddleware, createPaymentsRouter());
  router.use('/order-payments', authenticationMiddleware, tenantAuthorizationMiddleware, createOrderPaymentsRouter());
  router.use('/fulfillment', authenticationMiddleware, tenantAuthorizationMiddleware, createFulfillmentRouter());
  router.use('/revenue-expansion', authenticationMiddleware, tenantAuthorizationMiddleware, createRevenueExpansionRouter());
  router.use('/plans', authenticationMiddleware, tenantAuthorizationMiddleware, createPlansRouter());
  router.use('/pilot', authenticationMiddleware, tenantAuthorizationMiddleware, createPilotRouter());
  router.use('/establishments', authenticationMiddleware, tenantAuthorizationMiddleware, createEstablishmentSettingsRouter());
  router.use('/release', authenticationMiddleware, tenantAuthorizationMiddleware, createReleaseRouter());
  return router;
}
