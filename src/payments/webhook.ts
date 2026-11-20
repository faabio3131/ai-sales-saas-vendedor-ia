import { Request, Response } from 'express';
import { FirestorePaymentRepository, FirestorePaymentWebhookEventRepository } from './firestoreRepository';
import { FirestoreQuoteRepository } from '../quotes/firestoreRepository';
import { PaymentService } from './service';
import { MercadoPagoPixProvider, mercadoPagoSettingsFromEnv } from './mercadoPago';

/** Public endpoint accepts ONLY signed PSP notifications; never a browser-supplied tenant. */
export async function mercadoPagoWebhookHandler(req:Request,res:Response):Promise<void> {
  const settings=mercadoPagoSettingsFromEnv();
  if(!settings) { res.status(503).json({ok:false});return; }
  const provider=new MercadoPagoPixProvider(settings);
  // Signature is tied to query data.id; validation must use the id from URL, not an untrusted body alone.
  const dataId=typeof req.query['data.id']==='string'?req.query['data.id']:'';
  const body=req.body as Record<string,unknown>;
  const bodyId=(body&&typeof body.data==='object'&&body.data!==null)?
    String((body.data as Record<string,unknown>).id??''):'';
  if(!dataId || dataId!==bodyId || !(await provider.validateWebhook(req.headers,body))) {
    res.status(401).json({ok:false});return;
  }
  try {
    const service=new PaymentService(
      new FirestorePaymentRepository(),new FirestorePaymentWebhookEventRepository(),
      new FirestoreQuoteRepository(),provider);
    await service.handleWebhook({tenantId:settings.tenantId,requestId:'mp-'+dataId},req.headers,body);
    res.status(200).json({ok:true});
  } catch {
    // Don't acknowledge failures that require safe provider retry / reconciliation.
    res.status(503).json({ok:false});
  }
}
