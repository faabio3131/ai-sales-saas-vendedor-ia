import {createHash} from 'node:crypto';
import {ApplicationError} from '../infrastructure/errors';
import type {PaymentProviderInterface} from './contracts';
import type {Payment} from './model';
import {providerDescriptor,PaymentProviderId} from './providerCatalog';
import type {MerchantProviderConnectionRepository,MerchantProviderConnection} from './connections';
import type {MercadoPagoPixProvider} from './mercadoPago';

/** Persist only a digest, never the secret or Secret Manager path itself. */
export function merchantConnectionBindingHash(connection:MerchantProviderConnection):string {
  if(!connection.tenantId||!connection.providerId||!connection.recipientId||!connection.credentialRef)
    throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_CONNECTION_BINDING_REQUIRED',message:'Verified merchant binding required.'});
  return createHash('sha256').update(JSON.stringify([
    connection.tenantId,connection.providerId,connection.recipientId,connection.credentialRef,
    connection.version??0,
  ])).digest('hex');
}
export interface PaymentProviderResolver {
  forNewPayment(tenantId:string,providerId?:string):Promise<PaymentProviderInterface>;
  forNewPaymentWithBinding?(tenantId:string,providerId?:string):Promise<{provider:PaymentProviderInterface;bindingHash:string}>;
  forRecordedPayment(payment:Payment):Promise<PaymentProviderInterface>;
}
export class TenantPaymentProviderResolver implements PaymentProviderResolver {
  constructor(
    private readonly connections:MerchantProviderConnectionRepository,
    private readonly adapters:ReadonlyMap<string,PaymentProviderInterface>,
    private readonly createAdapter?:(connection:import('./connections').MerchantProviderConnection)=>Promise<PaymentProviderInterface>,
  ){}
  async forNewPayment(tenantId:string,providerId?:string):Promise<PaymentProviderInterface> {
    return (await this.forNewPaymentWithBinding(tenantId,providerId)).provider;
  }
  async forNewPaymentWithBinding(tenantId:string,providerId?:string):Promise<{provider:PaymentProviderInterface;bindingHash:string}> {
    return this.resolve(tenantId,providerId);
  }
  private async resolve(tenantId:string,providerId?:string) {
    if(!tenantId.trim()) throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_TENANT_REQUIRED',message:'Tenant required.'});
    const id=providerId??(await this.connections.preferences(tenantId)).preferredProviderId;
    if(!id) throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_PROVIDER_SELECTION_REQUIRED',message:'A payment provider must be selected.'});
    const desc=providerDescriptor(id);
    if(!desc||desc.status!=='ADAPTER_IMPLEMENTED') throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_PROVIDER_NOT_IMPLEMENTED',message:'Provider is not integrated.'});
    const connection=await this.connections.get(tenantId,id as PaymentProviderId);
    if(connection?.status!=='ACTIVE'||!connection.recipientId||!connection.credentialRef) {
      throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_CONNECTION_NOT_ACTIVE',message:'Payment connection is not active.'});
    }
    const adapter=this.adapters.get(id)??(this.createAdapter?await this.createAdapter(connection):undefined);
    if(!adapter||adapter.id!==id) throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_PROVIDER_NOT_CONFIGURED',message:'Provider credentials are not available.'});
    // Each merchant adapter must prove the tenant and recipient match the trusted binding.
    const bound=adapter as MercadoPagoPixProvider;
    if(bound.tenantId!==tenantId||bound.recipientId!==connection.recipientId) {
      throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_RECIPIENT_MISMATCH',message:'Merchant identity is not verified.'});
    }
    return {provider:adapter,bindingHash:merchantConnectionBindingHash(connection)};
  }
  async forRecordedPayment(payment:Payment):Promise<PaymentProviderInterface> {
    // Existing payments must never be sent to whichever merchant account is
    // currently configured. Unknown pre-migration bindings require investigation.
    const current=await this.resolve(payment.tenantId,payment.provider);
    if(!payment.merchantBindingHash||
      !/^[a-f0-9]{64}$/.test(payment.merchantBindingHash)||
      payment.merchantBindingHash!==current.bindingHash)
      throw new ApplicationError({category:'CONFLICT',code:'PAYMENT_HISTORICAL_BINDING_MISMATCH',
        message:'Recorded merchant connection has changed; manual reconciliation required.'});
    return current.provider;
  }
}
