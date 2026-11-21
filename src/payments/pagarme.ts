import type {ProviderPaymentRequest,ProviderPaymentResult} from './model';
import {createHash} from 'node:crypto';
import {PixOnlyProvider,ProviderTransport,fail,obj,str,minor,reference} from './bankCommon';
export interface PagarmeSettings {
 tenantId:string;recipientId:string;request:ProviderTransport;
 resolveCustomer:(customerId:string)=>Promise<string|null>;
}
export class PagarmePixProvider extends PixOnlyProvider {
 readonly id='PAGARME';readonly tenantId:string;readonly recipientId:string;
 constructor(private readonly cfg:PagarmeSettings){super();this.tenantId=cfg.tenantId;this.recipientId=cfg.recipientId;
  if(!cfg.tenantId||!cfg.recipientId)fail('PAGARME_CONFIG_INVALID');
 }
 private normalize(raw:unknown):ProviderPaymentResult {
  const order=obj(raw),id=str(order.id);
  const charges=Array.isArray(order.charges)?order.charges:[];
  const charge=charges.length?obj(charges[0]):{};
  const transaction=charge.last_transaction?obj(charge.last_transaction):{};
  const st=str(charge.status)||str(order.status);
  const status=st==='paid'?'CONFIRMED':st==='pending'?'PENDING':st==='failed'?'FAILED':st==='canceled'?'CANCELLED':null;
  const amount=minor(typeof charge.amount==='number'?charge.amount/100:NaN);
  const referenceId=str(order.code);
  if(!id||!status||!referenceId)return fail('PAGARME_RESPONSE_INVALID');
  return {provider:this.id,providerPaymentId:id,status,
   amountMinor:amount,referenceId,
   pixCode:str(transaction.qr_code)||undefined,
   paymentUrl:str(transaction.qr_code_url)||undefined,
  };
 }
 async createPix(input:ProviderPaymentRequest):Promise<ProviderPaymentResult>{
  if(input.tenantId!==this.tenantId)return fail('PAGARME_TENANT_MISMATCH');
  const customer=await this.cfg.resolveCustomer(input.customerId);
  if(!customer||!/^cus_[A-Za-z0-9]+$/.test(customer))return fail('PAGARME_CUSTOMER_NOT_MAPPED');
  const payload={
   code:reference(input),customer_id:customer,
   items:[{amount:input.amountMinor,description:'Pedido '+input.referenceId,quantity:1,code:input.referenceId}],
   payments:[{payment_method:'pix',pix:{expires_in:3600}}],
   closed:true,
  };
  const idempotency=createHash('sha256').update(input.tenantId+'\x00'+input.idempotencyKey).digest('hex');
  const result=this.normalize(await this.cfg.request('/core/v5/orders','POST',payload,{'Idempotency-Key':idempotency}));
  if(result.amountMinor!==input.amountMinor||result.referenceId!==reference(input))return fail('PAGARME_CHARGE_MISMATCH');
  if(!result.pixCode)return fail('PAGARME_QR_UNAVAILABLE');
  return result;
 }
 async getPaymentStatus(id:string):Promise<ProviderPaymentResult>{
  if(!/^or_[A-Za-z0-9]+$/.test(id))return fail('PAGARME_ORDER_ID_INVALID');
  return this.normalize(await this.cfg.request('/core/v5/orders/'+id,'GET'));
 }
}
