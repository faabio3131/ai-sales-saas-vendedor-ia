import type {ProviderPaymentRequest,ProviderPaymentResult} from './model';
import {PixOnlyProvider,ProviderTransport,fail,obj,str,minor,money,reference} from './bankCommon';
export interface AsaasSettings {
 tenantId:string;recipientId:string;request:ProviderTransport;
 /** Trusted mapping from internal customer to an Asaas customer ID. Never from untrusted request. */
 resolveCustomer:(customerId:string)=>Promise<string|null>;
}
export class AsaasPixProvider extends PixOnlyProvider {
 readonly id='ASAAS';
 readonly tenantId:string; readonly recipientId:string;
 constructor(private readonly cfg:AsaasSettings){
  super();this.tenantId=cfg.tenantId;this.recipientId=cfg.recipientId;
  if(!cfg.tenantId||!cfg.recipientId)fail('ASAAS_CONFIG_INVALID');
 }
 private normalize(j:Record<string,unknown>):ProviderPaymentResult {
  const id=str(j.id),status=str(j.status);
  const states:Record<string,ProviderPaymentResult['status']>={
   PENDING:'PENDING',CONFIRMED:'CONFIRMED',RECEIVED:'CONFIRMED',
   OVERDUE:'PENDING',REFUNDED:'REFUNDED' as ProviderPaymentResult['status'],
   RECEIVED_IN_CASH:'PENDING',DUNNING_REQUESTED:'PENDING',
  };
  if(!id||!states[status])return fail('ASAAS_RESPONSE_INVALID');
  return {provider:this.id,providerPaymentId:id,status:states[status],
   amountMinor:minor(j.value),referenceId:str(j.externalReference),
   paymentUrl:str(j.invoiceUrl)||undefined};
 }
 async preflightPix(input:ProviderPaymentRequest):Promise<void>{
  if(input.tenantId!==this.tenantId)return fail('ASAAS_TENANT_MISMATCH');
  const customer=await this.cfg.resolveCustomer(input.customerId);
  if(!customer||!/^cus_[A-Za-z0-9]+$/.test(customer))
    return fail('ASAAS_CUSTOMER_NOT_MAPPED');
 }
 async createPix(input:ProviderPaymentRequest):Promise<ProviderPaymentResult>{
  if(input.tenantId!==this.tenantId)return fail('ASAAS_TENANT_MISMATCH');
  const customer=await this.cfg.resolveCustomer(input.customerId);
  if(!customer||!/^cus_[A-Za-z0-9]+$/.test(customer))return fail('ASAAS_CUSTOMER_NOT_MAPPED');
  const dueDate=new Date(Date.now()+24*3600*1000).toISOString().slice(0,10);
  const raw=await this.cfg.request('/v3/payments','POST',{
    customer,billingType:'PIX',value:Number(money(input.amountMinor)),
    dueDate,description:'Pedido '+input.referenceId,externalReference:reference(input),
  });
  const result=this.normalize(obj(raw));
  if(result.referenceId!==reference(input)||result.amountMinor!==input.amountMinor)return fail('ASAAS_CHARGE_MISMATCH');
  const qr=await this.cfg.request('/v3/payments/'+encodeURIComponent(result.providerPaymentId)+'/pixQrCode','GET');
  result.pixCode=str(qr.payload)||undefined;
  result.pixQrCodeBase64=str(qr.encodedImage)||undefined;
  result.expiresAt=str(qr.expirationDate)||undefined;
  if(!result.pixCode)return fail('ASAAS_QR_UNAVAILABLE');
  return result;
 }
 async getPaymentStatus(id:string):Promise<ProviderPaymentResult>{
  if(!/^pay_[A-Za-z0-9]+$/.test(id))return fail('ASAAS_PAYMENT_ID_INVALID');
  return this.normalize(await this.cfg.request('/v3/payments/'+id,'GET'));
 }
}
