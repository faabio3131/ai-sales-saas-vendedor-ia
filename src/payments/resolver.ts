import {ApplicationError} from '../infrastructure/errors';
import type {PaymentProviderInterface} from './contracts';
import type {Payment} from './model';
import {providerDescriptor,PaymentProviderId} from './providerCatalog';
import type {MerchantProviderConnectionRepository} from './connections';
import type {MercadoPagoPixProvider} from './mercadoPago';

export interface PaymentProviderResolver {
  forNewPayment(tenantId:string,providerId?:string):Promise<PaymentProviderInterface>;
  forRecordedPayment(payment:Payment):Promise<PaymentProviderInterface>;
}
export class TenantPaymentProviderResolver implements PaymentProviderResolver {
  constructor(
    private readonly connections:MerchantProviderConnectionRepository,
    private readonly adapters:ReadonlyMap<string,PaymentProviderInterface>,
  ){}
  async forNewPayment(tenantId:string,providerId?:string):Promise<PaymentProviderInterface> {
    if(!tenantId.trim()) throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_TENANT_REQUIRED',message:'Tenant required.'});
    const id=providerId??(await this.connections.preferences(tenantId)).preferredProviderId;
    if(!id) throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_PROVIDER_SELECTION_REQUIRED',message:'A payment provider must be selected.'});
    const desc=providerDescriptor(id);
    if(!desc||desc.status!=='ADAPTER_IMPLEMENTED') throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_PROVIDER_NOT_IMPLEMENTED',message:'Provider is not integrated.'});
    const connection=await this.connections.get(tenantId,id as PaymentProviderId);
    if(connection?.status!=='ACTIVE'||!connection.recipientId||!connection.credentialRef) {
      throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_CONNECTION_NOT_ACTIVE',message:'Payment connection is not active.'});
    }
    const adapter=this.adapters.get(id);
    if(!adapter||adapter.id!==id) throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_PROVIDER_NOT_CONFIGURED',message:'Provider credentials are not available.'});
    // The current Mercado Pago adapter enforces the exact merchant tenant and recipient.
    if(id==='MERCADOPAGO') {
      const mp=adapter as MercadoPagoPixProvider;
      if(mp.tenantId!==tenantId||mp.recipientId!==connection.recipientId) {
        throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_RECIPIENT_MISMATCH',message:'Merchant identity is not verified.'});
      }
    }
    return adapter;
  }
  async forRecordedPayment(payment:Payment):Promise<PaymentProviderInterface> {
    // Sticky provider: never route a status check/refund to a different PSP.
    return this.forNewPayment(payment.tenantId,payment.provider);
  }
}
