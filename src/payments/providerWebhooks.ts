import {timingSafeEqual,createHmac} from 'node:crypto';
import type {Request,Response} from 'express';
import {ApplicationError} from '../infrastructure/errors';
import type {PaymentProviderId} from './providerCatalog';
import type {Payment,PaymentStatus} from './model';
import type {MerchantProviderConnectionRepository} from './connections';
import type {MerchantCredentialsVault} from './merchantVault';
import type {PaymentRepository} from './contracts';
import type {PaymentProviderResolver} from './resolver';

type Headers=Record<string,string|string[]|undefined>;
type EventDetails={paymentIds:string[];eventId:string};
const PIX_BANKS=new Set<string>(['EFI','BANCO_INTER','BANCO_DO_BRASIL']);
const DIRECT=new Set<string>(['ASAAS','PAGARME']);
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
export function authorizePaymentWebhook(args:{
 provider:string;tenantId:string;headers:Headers;rawBody:Buffer;secret:string;now?:number;
}):boolean {
 const {provider,tenantId,headers,rawBody,secret}=args;
 if(!secret||secret.length<16||rawBody.length===0||rawBody.length>256*1024)return false;
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
}
export class PaymentWebhookProcessor {
 constructor(private readonly runtime:PaymentWebhookRuntime){}
 async process(input:{
  provider:string;tenantId:string;headers:Headers;rawBody:Buffer;payload:unknown;
 }):Promise<PaymentStatus[]>{
  const {provider,tenantId,headers,rawBody,payload}=input;
  if(!ENABLED_WEBHOOK_PROVIDERS.has(provider)||!tenantId||tenantId.length>150)return deny();
  const connection=await this.runtime.connections.get(tenantId,provider as PaymentProviderId);
  if(!connection||connection.status!=='ACTIVE'||!connection.credentialRef||!connection.recipientId)return deny();
  const secrets=await this.runtime.vault.load(connection);
  if(secrets.tenantId!==tenantId||secrets.providerId!==provider||secrets.recipientId!==connection.recipientId)return deny();
  if(!authorizePaymentWebhook({provider,tenantId,headers,rawBody,secret:secrets.webhookSecret??''}))return deny();
  const event=parsePaymentWebhook(provider,payload);
  const statuses:PaymentStatus[]=[];
  for(const providerPaymentId of event.paymentIds){
   const persisted=await this.runtime.payments.findByProviderPaymentId(tenantId,provider,providerPaymentId);
   if(!persisted)return deny();
   // The event's status is ignored; only an authenticated provider GET can
   // advance payment state and dispatch the fiscal confirmation observer.
   const result=await this.runtime.service.refresh({tenantId,requestId:'bank-webhook'},persisted.id);
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
