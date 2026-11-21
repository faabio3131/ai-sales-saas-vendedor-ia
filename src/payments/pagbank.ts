import {createHash} from 'node:crypto';
import type {ProviderPaymentRequest,ProviderPaymentResult} from './model';
import {PixOnlyProvider,ProviderTransport,fail,obj,str,reference} from './bankCommon';

export interface PagBankCustomer {
 name:string;
 email:string;
 taxId:string;
 phone:{area:string;number:string};
}
export interface PagBankSettings {
 tenantId:string;
 recipientId:string;
 request:ProviderTransport;
 resolveCustomer:(customerId:string)=>Promise<PagBankCustomer|null>;
}
/** PagBank Orders API, Pix charges. Webhook is intentionally disabled pending verification. */
export class PagBankPixProvider extends PixOnlyProvider {
 readonly id='PAGBANK';
 readonly tenantId:string;
 readonly recipientId:string;
 constructor(private readonly cfg:PagBankSettings){
  super();this.tenantId=cfg.tenantId;this.recipientId=cfg.recipientId;
  if(!cfg.tenantId||!cfg.recipientId)fail('PAGBANK_CONFIG_INVALID');
 }
 private normalize(raw:unknown):ProviderPaymentResult {
  const order=obj(raw);
  const id=str(order.id);
  if(!/^ORDE_[A-Za-z0-9-]{8,80}$/.test(id))return fail('PAGBANK_ORDER_ID_INVALID');
  const charges=Array.isArray(order.charges)?order.charges:[];
  if(charges.length!==1)return fail('PAGBANK_CHARGE_COUNT_INVALID');
  const charge=obj(charges[0]);
  const amount=obj(charge.amount);
  const amountMinor=amount.value;
  if(!Number.isSafeInteger(amountMinor)||typeof amountMinor!=='number'||amountMinor<=0||str(amount.currency)!=='BRL')
   return fail('PAGBANK_AMOUNT_INVALID');
  const status=str(charge.status);
  const states:Record<string,ProviderPaymentResult['status']>={
   WAITING:'PENDING',PAID:'CONFIRMED',DECLINED:'FAILED',CANCELED:'CANCELLED',CANCELLED:'CANCELLED'
  };
  if(!states[status])return fail('PAGBANK_STATUS_INVALID');
  const paymentMethod=obj(charge.payment_method);
  if(str(paymentMethod.type).toUpperCase()!=='PIX')return fail('PAGBANK_METHOD_MISMATCH');
  const referenceId=str(order.reference_id);
  if(!referenceId)return fail('PAGBANK_REFERENCE_MISSING');
  const qr=charge.qr_code&&typeof charge.qr_code==='object'?obj(charge.qr_code):{};
  return {provider:this.id,providerPaymentId:id,status:states[status],amountMinor,
   referenceId,pixCode:str(qr.text)||undefined};
 }
 async createPix(input:ProviderPaymentRequest):Promise<ProviderPaymentResult>{
  if(input.tenantId!==this.tenantId)return fail('PAGBANK_TENANT_MISMATCH');
  if(!Number.isSafeInteger(input.amountMinor)||input.amountMinor<=0)return fail('PAGBANK_AMOUNT_INVALID');
  const customer=await this.cfg.resolveCustomer(input.customerId);
  if(!customer||!customer.name?.trim()||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)||
    !/^\d{11}$|^\d{14}$/.test(customer.taxId)||!/^\d{2}$/.test(customer.phone.area)||
    !/^\d{8,9}$/.test(customer.phone.number))return fail('PAGBANK_CUSTOMER_DATA_MISSING');
  const ref='av-'+createHash('sha256').update(reference(input)).digest('hex').slice(0,32);
  const expiresAt=new Date(Date.now()+3600_000).toISOString();
  const payload={
   reference_id:ref,
   customer:{name:customer.name,email:customer.email,tax_id:customer.taxId,
    phones:[{country:'55',area:customer.phone.area,number:customer.phone.number,type:'MOBILE'}]},
   items:[{reference_id:ref,name:'Pedido '+input.referenceId,quantity:1,unit_amount:input.amountMinor}],
   charges:[{reference_id:ref,description:'Pedido '+input.referenceId,amount:{value:input.amountMinor,currency:'BRL'},
     payment_method:{type:'PIX',pix:{expiration_date:expiresAt}}}],
  };
  const result=this.normalize(await this.cfg.request('/orders','POST',payload,{
   'x-idempotency-key':createHash('sha256').update(input.tenantId+'\x00'+input.idempotencyKey).digest('hex'),
  }));
  if(result.referenceId!==ref||result.amountMinor!==input.amountMinor)return fail('PAGBANK_CHARGE_MISMATCH');
  if(!result.pixCode)return fail('PAGBANK_PIX_QR_MISSING');
  return result;
 }
 async getPaymentStatus(id:string):Promise<ProviderPaymentResult>{
  if(!/^ORDE_[A-Za-z0-9-]{8,80}$/.test(id))return fail('PAGBANK_ORDER_ID_INVALID');
  return this.normalize(await this.cfg.request('/orders/'+id,'GET'));
 }
}
