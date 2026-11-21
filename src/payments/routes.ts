import { Request, Router } from 'express';
import { FirestoreSalesFiscalHandoffRepository } from '../fiscal/firestoreRepository';
import { SalesFiscalHandoffService } from '../fiscal/service';
import { ApplicationError } from '../infrastructure/errors';
import { FirestoreQuoteItemRepository, FirestoreQuoteRepository } from '../quotes/firestoreRepository';
import { FirestorePaymentRepository, FirestorePaymentWebhookEventRepository } from './firestoreRepository';
import { StructuralPaymentProvider } from './provider';
import { PaymentService } from './service';
import { MercadoPagoPixProvider, mercadoPagoSettingsFromEnv } from './mercadoPago';
import { FirestorePaymentMethodsRepository, PaymentMethodsService } from './methods';
import { FirestoreMerchantProviderConnectionRepository, MerchantPaymentConnectionsService } from './connections';
import { TenantPaymentProviderResolver } from './resolver';
import { PAYMENT_PROVIDER_CATALOG } from './providerCatalog';
import {GoogleSecretManagerMerchantVault} from './merchantVault';
import {MountedMerchantCredentialsVault} from './mountedVault';
import {MerchantPaymentAdapterFactory} from './adapterFactory';
import {FirestoreMerchantCustomerMap} from './customerMap';

function requireContext(req: Request) {
  if (!req.tenantContext) throw new ApplicationError({ category:'FORBIDDEN', code:'TENANT_CONTEXT_REQUIRED', message:'Tenant context is required.' });
  return req.tenantContext;
}

export function createPaymentsRouter(): Router {
  const router = Router();
  const quotes = new FirestoreQuoteRepository();
  const fiscalObserver = new SalesFiscalHandoffService(
    new FirestoreSalesFiscalHandoffRepository(),
    quotes,
    new FirestoreQuoteItemRepository(),
  );
  const methodSettings = new PaymentMethodsService(new FirestorePaymentMethodsRepository());
  const mpConfig=mercadoPagoSettingsFromEnv();
  const provider=mpConfig?new MercadoPagoPixProvider(mpConfig):new StructuralPaymentProvider();
  const connectionRepo=new FirestoreMerchantProviderConnectionRepository();
  const connectionService=new MerchantPaymentConnectionsService(connectionRepo);
  const adapterMap=new Map<string,import('./contracts').PaymentProviderInterface>();
  if(mpConfig) adapterMap.set('MERCADOPAGO',provider);
  const vault=process.env.PAYMENT_VAULT_BACKEND==='MOUNTED'
    ? new MountedMerchantCredentialsVault()
    : new GoogleSecretManagerMerchantVault();
  const factory=new MerchantPaymentAdapterFactory(vault,new FirestoreMerchantCustomerMap());
  const resolver=new TenantPaymentProviderResolver(connectionRepo,adapterMap,connection=>factory.build(connection));
  const service = new PaymentService(
    new FirestorePaymentRepository(),
    new FirestorePaymentWebhookEventRepository(),
    quotes,
    provider,
    fiscalObserver,
    methodSettings,
    resolver,
  );

  router.post('/webhook/mercadopago', async (_req, _res, next) => {
    next(new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_WEBHOOK_DEDICATED_ROUTE',message:'Use dedicated payment webhook endpoint.'}));
  });
  router.get('/providers', (_req,res) => res.status(200).json({ok:true,data:PAYMENT_PROVIDER_CATALOG}));
  router.get('/connections', async (req,res,next) => {
    try {res.status(200).json({ok:true,data:await connectionService.overview(requireContext(req))});}
    catch(error){next(error);}
  });
  router.put('/connections/preference', async (req,res,next) => {
    try {res.status(200).json({ok:true,data:await connectionService.setPreference(requireContext(req),req.body)});}
    catch(error){next(error);}
  });

  router.get('/methods', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await methodSettings.get(requireContext(req)) }); } catch (error) { next(error); }
  });
  router.put('/methods', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await methodSettings.update(requireContext(req), req.body) }); } catch (error) { next(error); }
  });

  router.get('/', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await service.list(requireContext(req)) }); } catch (error) { next(error); }
  });
  router.get('/:id', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await service.get(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });
  router.post('/', async (req, res, next) => {
    try { res.status(201).json({ ok:true, data:await service.create(requireContext(req), req.body ?? {}) }); } catch (error) { next(error); }
  });
  router.post('/:id/refresh', async (req, res, next) => {
    try { res.status(200).json({ ok:true, data:await service.refresh(requireContext(req), req.params.id) }); } catch (error) { next(error); }
  });
  // Provider webhooks must not use the authenticated tenant API; use the dedicated signed endpoint.
  return router;
}
