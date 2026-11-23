import type {Request,Response} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import {createBankPaymentRuntime} from './bankRuntime';
import {PaymentWebhookProcessor} from './providerWebhooks';

/** Legacy single-tenant URL is a *tenant alias*, not a separate PSP execution path.
 * No environment credential or callback payload can bypass the canonical vault,
 * durable inbox, PSP GET reconciliation or the multissector payment resolver.
 * New tenants must use /payments/webhooks/MERCADOPAGO/:tenantId.
 */
export async function mercadoPagoWebhookHandler(req:Request,res:Response):Promise<void>{
 const tenantId=process.env.MP_PIX_TENANT_ID?.trim()??'';
 const dataId=typeof req.query['data.id']==='string'?req.query['data.id']:'';
 const body=req.body;
 const data=body&&typeof body==='object'&&!Array.isArray(body)&&'data' in body
  ? (body as {data?:unknown}).data:null;
 const bodyId=data&&typeof data==='object'&&!Array.isArray(data)&&'id' in data
  ? String((data as {id:unknown}).id??''):'';
 const raw=(req as Request&{paymentRawBody?:Buffer}).paymentRawBody;
 if(!tenantId){res.status(503).json({ok:false});return;}
 if(!raw||!String.raw`/^\d{1,30}$/`.test(dataId)||dataId!==bodyId){
  res.status(401).json({ok:false});return;
 }
 try{
  const processor=new PaymentWebhookProcessor(createBankPaymentRuntime());
  const statuses=await processor.process({provider:'MERCADOPAGO',
   tenantId,headers:req.headers,rawBody:raw,payload:body,queryPaymentId:dataId});
  res.status(200).json({ok:true,processed:statuses.length});
 }catch(error){
  const denied=error instanceof ApplicationError&&
   (error.category==='FORBIDDEN'||error.category==='NOT_FOUND');
  res.status(denied?401:503).json({ok:false});
 }
}
