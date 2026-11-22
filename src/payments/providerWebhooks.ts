import {timingSafeEqual,createHmac,createHash,createPublicKey,verify as verifySignature} from 'node:crypto';
import type {Request,Response} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import type {PaymentProviderId} from './providerCatalog';
import type {Payment,PaymentStatus} from './model';
import type {OrderPaymentRepository,OrderPaymentStatus} from '../orderPayments/model';
import type {OrderPaymentService} from '../orderPayments/service';
import type {MerchantProviderConnectionRepository} from './connections';
import type {MerchantCredentialsVault} from './merchantVault';
import type {PaymentRepository} from './contracts';
import type {VerifiedPaymentWebhookLedger} from './webhookLedger';

type Headers=Record<string,string|string[]|undefined>;
type EventDetails={paymentIds:string[];eventId:string};
const PIX_BANKS=new Set<string>(['EFI','BANCO_INTER','BANCO_DO_BRASIL']);
const DIRECT=new Set<string>(['ASAAS','PAGARME','PAGBANK']);
export const ENABLED_WEBHOOK_PROVIDERS=new Set<string>([...PIX_BANKS,...DIRECT]);

function deny():never {
 throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_WEBHOOK_UNAUTHORIZED',message:'Invalid payment callback authorization.'});
}
function bodyRecord(payload:unknown):Record<string,unknown>{
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return deny();
 return payload as Record<string,unknown>;
}
function string(value:unknown):string{return typeof value==='string'?value:'';}
function header(headers:Headers,name:string):string {
 const value=headers[name.toLowerCase()];
 return typeof value==='string'?value:'';
}
function equals(actual:string,expected:string):boolean {
 const x=Buffer.from(actual,'utf8'),y=Buffer.from(expected,'utf8');
 return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);
}
function hmac(secret:string,message:Buffer|string):Buffer{
 return createHmac('sha256',secret).update(message).digest();
}
function verifyDigest(headerValue:string,expected:Buffer):boolean{
 const encoded=headerValue.toLowerCase().startsWith('sha256=')?headerValue.slice(7):headerValue;
 if(!/^[a-fA-F0-9]{64}$/.test(encoded))return false;
 const provided=Buffer.from(encoded,'hex');
 return provided.length===expected.length&&timingSafeEqual(provided,expected);
}
/**
 * PagBank new Notification API: SHA256withECDSA over the original bytes.
 * Key is pinned per merchant from out-of-band provider verification. NEVER
 * derive the digest from the API token or trust an unsigned callback.
 */
export function verifyPagBankEcdsa(value:string|string[]|undefined,raw:Buffer,keyBase64?:string){
 if(!keyBase64||!/^[A-Za-z0-9+/=]{80,3000}$/.test(keyBase64)||raw.length===0||raw.length>256*1024)return false;
 const candidates=(Array.isArray(value)?value:[value??'']).flatMap(x=>x.split(','))
  .map(s=>s.trim()).filter(Boolean).slice(0,6);
 if(!candidates.length)return false;
 try{
  const publicKey=createPublicKey({key:Buffer.from(keyBase64,'base64'),format:'der',type:'spki'});
  if(publicKey.asymmetricKeyType!=='ec')return false;
  return candidates.some(candidate=>{
   if(!/^[A-Za-z0-9+/=]{60,300}$/.test(candidate))return false;
   try{return verifySignature('sha256',raw,publicKey,Buffer.from(candidate,'base64'));}
   catch{return false;}
  });
 }catch{return false;}
}
export function authorizePaymentWebhook(args:{
 provider:string;tenantId:string;headers:Headers;rawBody:Buffer;secret:string;
 publicKeyBase64?:string;now?:number;
}):boolean {
 const {provider,tenantId,headers,rawBody,secret}=args;
 if(rawBody.length===0||rawBody.length>256*1024)return false;
 if(provider==='PAGBANK')return verifyPagBankEcdsa(headers['x-payload-signature'],rawBody,args.publicKeyBase64);
 if(!secret||secret.length<16)return false;
 if(provider==='ASAAS')return equals(header(headers,'asaas-access-token'),secret);
 if(provider==='PAGARME')return verifyDigest(header(headers,'x-hub-signature'),hmac(secret,rawBody));
 if(PIX_BANKS.has(provider)){
  // mTLS must terminate at an independently configured edge. The edge forwards
  // an HMAC envelope; a caller-supplied X-Forwarded-Client-Cert is never trusted.
  const ts=header(headers,'x-av-relay-timestamp');
  if(!/^\d{10}$/.test(ts))return false;
  const epoch=Number(ts)*1000,now=args.now??Date.now();
  if(!Number.isFinite(epoch)||Math.abs(epoch-now)>5*60_000)return false;
  const message=Buffer.concat([Buffer.from(provider+'\n'+tenantId+'\n'+ts+'\n'),rawBody]);
  return verifyDigest(header(headers,'x-av-relay-signature'),hmac(secret,message));
 }
 return false;
}
export function parsePaymentWebhook(provider:string,payload:unknown):EventDetails {
 const body=bodyRecord(payload);
 if(provider==='ASAAS'){
  const payment=bodyRecord(body.payment);
  const id=string(payment.id),eventId=string(body.id);
  if(!/^pay_[a-zA-Z0-9]+$/.test(id)||!eventId||eventId.length>160)return deny();
  return {paymentIds:[id],eventId};
 }
 if(provider==='PAGARME'){
  const data=bodyRecord(body.data);
  const eventId=string(body.id);
  const order=data.order&&typeof data.order==='object'?bodyRecord(data.order):data;
  const id=string(order.id);
  if(!/^or_[a-zA-Z0-9]+$/.test(id)||!eventId||eventId.length>160)return deny();
  return {paymentIds:[id],eventId};
 }
 if(provider==='PAGBANK'){
  const orderId=string(body.id);
  if(!/^ORDE_[A-Za-z0-9-]{8,80}$/.test(orderId)||!Array.isArray(body.charges)||body.charges.length!==1)
   return deny();
  const charge=bodyRecord(body.charges[0]);
  if(!/^CHAR_[A-Za-z0-9-]{8,80}$/.test(string(charge.id))||
   !['PAID','WAITING','DECLINED','CANCELED','CANCELLED'].includes(string(charge.status)))return deny();
  const eventId='pagbank:'+createHash('sha256').update(JSON.stringify(body)).digest('hex');
  return {paymentIds:[orderId],eventId};
 }
 if(PIX_BANKS.has(provider)){
  if(!Array.isArray(body.pix)||body.pix.length===0||body.pix.length>50)return deny();
  const ids=body.pix.map((item:unknown)=>{
   const id=string(bodyRecord(item).txid);
   if(!/^[a-zA-Z0-9]{26,35}$/.test(id))return deny();
   return id;
  });
  return {paymentIds:[...new Set(ids)],eventId:'pix:'+ids.join(':')};
 }
 return deny();
}
export interface WebhookRefreshService {
 refresh(context:{tenantId:string;requestId:string},id:string):Promise<Payment>;
}
export interface PaymentWebhookRuntime {
 connections:MerchantProviderConnectionRepository;
 vault:MerchantCredentialsVault;
 payments:PaymentRepository;
 service:WebhookRefreshService;
 audit?:VerifiedPaymentWebhookLedger;
 orderPayments?:Pick<OrderPaymentRepository,'byProvider'>;
 orderService?:Pick<OrderPaymentService,'refreshFromWebhook'>;
}
export class PaymentWebhookProcessor {
 constructor(private readonly runtime:PaymentWebhookRuntime){}
 async process(input:{
  provider:string;tenantId:string;headers:Headers;rawBody:Buffer;payload:unknown;
 }):Promise<Array<PaymentStatus|OrderPaymentStatus>>{
  const {provider,tenantId,headers,rawBody,payload}=input;
  if(!ENABLED_WEBHOOK_PROVIDERS.has(provider)||!tenantId||tenantId.length>150)return deny();
  const connection=await this.runtime.connections.get(tenantId,provider as PaymentProviderId);
  if(!connection||connection.status!=='ACTIVE'||!connection.credentialRef||!connection.recipientId)return deny();
  const secrets=await this.runtime.vault.load(connection);
  if(secrets.tenantId!==tenantId||secrets.providerId!==provider||secrets.recipientId!==connection.recipientId)return deny();
  if(!authorizePaymentWebhook({provider,tenantId,headers,rawBody,secret:secrets.webhookSecret??'',
   publicKeyBase64:secrets.webhookPublicKeyBase64}))return deny();
  const event=parsePaymentWebhook(provider,payload);
  const statuses:Array<PaymentStatus|OrderPaymentStatus>=[];
  for(const providerPaymentId of event.paymentIds){
   const persisted=await this.runtime.payments.findByProviderPaymentId(tenantId,provider,providerPaymentId);
   // Webhook payload status is NEVER used. Only tenant-bound PSP GET can
   // reconcile a legacy quote payment or a new T04 order payment.
   if(persisted){
    const result=await this.runtime.service.refresh({tenantId,requestId:'bank-webhook'},persisted.id);
    await this.runtime.audit?.record({
     tenantId,provider,eventId:event.eventId,providerPaymentId,
     paymentId:persisted.id,verifiedStatus:result.status,
    });
    statuses.push(result.status);
    continue;
   }
   const orderPayment=await this.runtime.orderPayments?.byProvider(tenantId,provider,providerPaymentId);
   if(!orderPayment||!this.runtime.orderService)return deny();
   const result=await this.runtime.orderService.refreshFromWebhook(tenantId,provider,providerPaymentId);
   if(!result)return deny();
   await this.runtime.audit?.record({
    tenantId,provider,eventId:event.eventId,providerPaymentId,
    paymentId:orderPayment.id,verifiedStatus:result.status,
   });
   statuses.push(result.status);
  }
  return statuses;
 }
}
export async function handleBankWebhook(req:Request,res:Response,processor:PaymentWebhookProcessor):Promise<void>{
 const provider=String(req.params.provider??'').toUpperCase();
 const tenantId=String(req.params.tenantId??'');
 const raw=(req as Request&{paymentRawBody?:Buffer}).paymentRawBody;
 if(!raw){res.status(401).json({ok:false});return;}
 try{
  const statuses=await processor.process({provider,tenantId,headers:req.headers,rawBody:raw,payload:req.body});
  res.status(200).json({ok:true,processed:statuses.length});
 }catch(error){
  const forbidden=error instanceof ApplicationError&&(error.category==='FORBIDDEN'||error.category==='NOT_FOUND');
  res.status(forbidden?401:503).json({ok:false});
 }
}
