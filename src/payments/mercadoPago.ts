import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApplicationError } from '../infrastructure/errors';
import { PaymentProviderInterface } from './contracts';
import { NormalizedPaymentWebhook, ProviderPaymentRequest, ProviderPaymentResult } from './model';

type JsonRecord = Record<string, unknown>;
type MpPayload = {
  id?: number | string;
  status?: string;
  external_reference?: string;
  transaction_amount?: number;
  collector_id?: number | string;
  date_of_expiration?: string;
  point_of_interaction?: {transaction_data?: {qr_code?: string;qr_code_base64?: string;ticket_url?: string}};
};
const STATE: Record<string, ProviderPaymentResult['status']> = {
  approved:'CONFIRMED', pending:'PENDING', in_process:'PENDING', authorized:'PENDING',
  rejected:'FAILED', cancelled:'CANCELLED', refunded:'REFUNDED' as ProviderPaymentResult['status'],
  charged_back:'FAILED',
};
function invalid(code:string, message:string):never {
  throw new ApplicationError({category:'PROVIDER',code,message,retryable:false});
}
function asText(v:unknown): string {return typeof v==='string' ? v : typeof v==='number' ? String(v) : '';}
function isRecord(v:unknown): v is JsonRecord {return Boolean(v)&&typeof v==='object'&&!Array.isArray(v);}
function cleanEmail(v:unknown): string {
  if(typeof v!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())||v.length>254) {
    invalid('PAYMENT_PAYER_EMAIL_REQUIRED','A valid customer email is required for Mercado Pago Pix.');
  }
  return (v as string).trim();
}
export interface MercadoPagoPixSettings {
  tenantId:string;
  accessToken:string;
  webhookSecret:string;
  collectorId:string;
  fetchImpl?: typeof fetch;
  baseUrl?: string; // HTTPS official URL in production; injected testing transport only
}
export function mercadoPagoSettingsFromEnv(env: NodeJS.ProcessEnv=process.env): MercadoPagoPixSettings|null {
  const tenantId=env.MP_PIX_TENANT_ID?.trim();
  const accessToken=env.MP_PIX_ACCESS_TOKEN?.trim();
  const webhookSecret=env.MP_PIX_WEBHOOK_SECRET?.trim();
  const collectorId=env.MP_PIX_COLLECTOR_ID?.trim();
  if(!tenantId || !accessToken || !webhookSecret || !collectorId) return null;
  return {tenantId,accessToken,webhookSecret,collectorId};
}
/** A single-merchant integration; fail closed on every other tenant. */
export class MercadoPagoPixProvider implements PaymentProviderInterface {
  readonly id='MERCADOPAGO';
  private readonly baseUrl:string;
  private readonly fetchImpl:typeof fetch;
  constructor(private readonly settings:MercadoPagoPixSettings) {
    for(const key of ['tenantId','accessToken','webhookSecret','collectorId'] as const) {
      if(!settings[key]?.trim()) invalid('MP_CONFIGURATION_INVALID','Mercado Pago configuration is incomplete.');
    }
    this.baseUrl=(settings.baseUrl??'https://api.mercadopago.com').replace(/\/$/,'');
    if(settings.baseUrl && process.env.NODE_ENV!=='test') invalid('MP_BASE_URL_FORBIDDEN','Payment host override is forbidden outside tests.');
    this.fetchImpl=settings.fetchImpl??fetch;
  }
  get tenantId():string{return this.settings.tenantId;}
  private async request(path:string,init?:RequestInit):Promise<MpPayload> {
    let response:Response;
    try {
      response=await this.fetchImpl(this.baseUrl+path,{
        ...init,headers:{'Authorization': 'Bearer '+this.settings.accessToken,'Accept':'application/json',
          ...(init?.headers??{})},signal:AbortSignal.timeout(12000)
      });
    } catch {
      throw new ApplicationError({category:'PROVIDER',code:'MP_NETWORK_FAILURE',message:'Mercado Pago is unavailable.',retryable:true});
    }
    if(!response.ok) {
      throw new ApplicationError({category:'PROVIDER',code:'MP_REQUEST_FAILED',message:'Payment provider rejected the request.',retryable:response.status>=500||response.status===429});
    }
    const payload:unknown=await response.json().catch(()=>null);
    if(!isRecord(payload)) return invalid('MP_RESPONSE_INVALID','Invalid payment provider response.');
    return payload as MpPayload;
  }
  private normalize(payment:MpPayload):ProviderPaymentResult {
    const id=asText(payment.id);
    const status=payment.status ? STATE[payment.status] : undefined;
    if(!id || !status || !Number.isInteger(Math.round((payment.transaction_amount??NaN)*100))) return invalid('MP_RESPONSE_INVALID','Invalid payment provider payment data.');
    if(asText(payment.collector_id)!==this.settings.collectorId) return invalid('MP_PAYEE_MISMATCH','Payment receiver mismatch.');
    const amountMinor=Math.round((payment.transaction_amount??0)*100);
    if(!Number.isSafeInteger(amountMinor)||amountMinor<=0) return invalid('MP_AMOUNT_INVALID','Invalid payment provider amount.');
    return {
      provider:this.id,providerPaymentId:id,status,
      amountMinor,referenceId:payment.external_reference,
      paymentUrl:payment.point_of_interaction?.transaction_data?.ticket_url,
      pixCode:payment.point_of_interaction?.transaction_data?.qr_code,
      pixQrCodeBase64:payment.point_of_interaction?.transaction_data?.qr_code_base64,
      expiresAt:payment.date_of_expiration,
    };
  }
  async createPix(input:ProviderPaymentRequest):Promise<ProviderPaymentResult> {
    if(input.tenantId!==this.tenantId) return invalid('MP_TENANT_DENIED','Payment merchant does not match tenant.');
    if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0||input.currency!=='BRL') return invalid('MP_AMOUNT_INVALID','Invalid payment amount.');
    const email=cleanEmail(input.payerEmail);
    const response=await this.request('/v1/payments',{method:'POST',
      headers:{'Content-Type':'application/json','X-Idempotency-Key':input.tenantId+':'+input.idempotencyKey},
      body:JSON.stringify({transaction_amount:input.amountMinor/100,payment_method_id:'pix',
        description:'Pedido '+input.referenceId,external_reference:input.tenantId+':'+input.referenceId,
        payer:{email}})
    });
    const output=this.normalize(response);
    if(output.amountMinor!==input.amountMinor||output.referenceId!==input.tenantId+':'+input.referenceId) return invalid('MP_PAYMENT_MISMATCH','Payment data failed reconciliation.');
    if(!output.pixCode || !output.paymentUrl) return invalid('MP_PIX_MISSING','Payment provider did not return Pix data.');
    return output;
  }
  async getPaymentStatus(providerPaymentId:string) {
    if(!/^\d{1,30}$/.test(providerPaymentId)) return invalid('MP_ID_INVALID','Invalid payment reference.');
    return this.normalize(await this.request('/v1/payments/'+providerPaymentId));
  }
  async createPaymentLink(_input:ProviderPaymentRequest):Promise<ProviderPaymentResult> {return invalid('MP_METHOD_UNSUPPORTED','Payment link is not configured.');}
  async createCheckout(_input:ProviderPaymentRequest):Promise<ProviderPaymentResult> {return invalid('MP_METHOD_UNSUPPORTED','Checkout is not configured.');}
  async cancelPayment(_id:string):Promise<ProviderPaymentResult> {return invalid('MP_METHOD_UNSUPPORTED','Cancellation requires a governed flow.');}
  async refundPayment(_id:string):Promise<ProviderPaymentResult> {return invalid('MP_METHOD_UNSUPPORTED','Refund requires a governed flow.');}
  async validateWebhook(headers:Record<string,string|string[]|undefined>, payload:unknown):Promise<boolean> {
    const signature=typeof headers['x-signature']==='string'?headers['x-signature']:'';
    const requestId=typeof headers['x-request-id']==='string'?headers['x-request-id']:'';
    const id=isRecord(payload)&&isRecord(payload.data)?asText(payload.data.id):'';
    const bits=Object.fromEntries(signature.split(',').map(s=>s.trim().split('=',2)));
    if(!id||!requestId||!/^\d{10,16}$/.test(bits.ts??'')||! /^[0-9a-f]{64}$/i.test(bits.v1??'')) return false;
    if(Math.abs(Date.now()-Number(bits.ts)*(bits.ts.length===10?1000:1))>5*60_000) return false;
    const manifest='id:'+id.toLowerCase()+';request-id:'+requestId+';ts:'+bits.ts+';';
    const calculated=createHmac('sha256',this.settings.webhookSecret).update(manifest).digest();
    const received=Buffer.from(bits.v1,'hex');
    return received.length===calculated.length&&timingSafeEqual(received,calculated);
  }
  async normalizeWebhook(payload:unknown):Promise<NormalizedPaymentWebhook> {
    if(!isRecord(payload)||!isRecord(payload.data)) return invalid('MP_WEBHOOK_INVALID','Invalid provider notification.');
    const id=asText(payload.data.id);
    const eventId=asText(payload.id);
    if(!/^\d{1,30}$/.test(id)||!eventId) return invalid('MP_WEBHOOK_INVALID','Invalid provider notification.');
    // Do not trust event status: the PaymentService always re-fetches official payment data.
    return {eventId,providerPaymentId:id,status:'PENDING',occurredAt:new Date().toISOString()};
  }
}
