import {createHash} from 'node:crypto';
import {ApplicationError} from '../infrastructure/errors';
import type {PaymentProviderInterface} from './contracts';
import type {ProviderPaymentRequest,ProviderPaymentResult,NormalizedPaymentWebhook} from './model';

export type ProviderJson=Record<string,unknown>;
export type ProviderTransport=(path:string,method:string,body?:ProviderJson)=>Promise<ProviderJson>;
export function fail(code:string, message='Payment provider operation unavailable.'):never {
 throw new ApplicationError({category:'PROVIDER',code,message,retryable:false});
}
export function obj(x:unknown):ProviderJson {
 if(!x||typeof x!=='object'||Array.isArray(x)) return fail('BANK_RESPONSE_INVALID');
 return x as ProviderJson;
}
export const str=(x:unknown)=>typeof x==='string'?x:typeof x==='number'?String(x):'';
export function money(minor:number):string {
 if(!Number.isSafeInteger(minor)||minor<=0) return fail('BANK_AMOUNT_INVALID');
 return (minor/100).toFixed(2);
}
export function minor(x:unknown):number {
 if(typeof x!=='string'&&typeof x!=='number') return fail('BANK_AMOUNT_INVALID');
 const value=Number(x);
 const converted=Math.round(value*100);
 if(!Number.isSafeInteger(converted)||converted<=0||Math.abs(value*100-converted)>0.00001) return fail('BANK_AMOUNT_INVALID');
 return converted;
}
export function reference(input:ProviderPaymentRequest):string {
 if(!input.tenantId?.trim()||!input.referenceId?.trim()||input.currency!=='BRL')return fail('BANK_REQUEST_INVALID');
 return input.tenantId+':'+input.referenceId;
}
export function txid(input:ProviderPaymentRequest):string {
 return createHash('sha256').update(input.tenantId+'\x00'+input.idempotencyKey).digest('hex').slice(0,32);
}
export abstract class PixOnlyProvider implements PaymentProviderInterface {
 abstract readonly id:string;
 abstract createPix(input:ProviderPaymentRequest):Promise<ProviderPaymentResult>;
 abstract getPaymentStatus(id:string):Promise<ProviderPaymentResult>;
 async createPaymentLink(_input:ProviderPaymentRequest):Promise<ProviderPaymentResult>{return fail('BANK_PAYMENT_LINK_UNSUPPORTED');}
 async createCheckout(_input:ProviderPaymentRequest):Promise<ProviderPaymentResult>{return fail('BANK_CHECKOUT_UNSUPPORTED');}
 async cancelPayment(_id:string):Promise<ProviderPaymentResult>{return fail('BANK_CANCEL_UNSUPPORTED');}
 async refundPayment(_id:string):Promise<ProviderPaymentResult>{return fail('BANK_REFUND_REQUIRES_GOVERNANCE');}
 async validateWebhook(_headers:Record<string,string|string[]|undefined>,_payload:unknown):Promise<boolean>{return false;}
 async normalizeWebhook(_payload:unknown):Promise<NormalizedPaymentWebhook>{return fail('BANK_WEBHOOK_UNSUPPORTED');}
}
