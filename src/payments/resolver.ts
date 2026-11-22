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
/** A mutable alias is not a historical credential generation. Secret Manager
 * numeric versions are immutable; 'latest' and mounted overwritable paths are not.
 */
export function isPinnedHistoricalVaultReference(ref:string|undefined):boolean {
  return typeof ref==='string' &&
   /^projects\/[a-zA-Z0-9_-]{4,80}\/secrets\/[a-zA-Z0-9_-]{1,200}\/versions\/[1-9][0-9]*$/.test(ref);
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
    const provider=payment.provider as PaymentProviderId;
    const active=await this.connections.get(payment.tenantId,provider);
    if(active?.status!=='ACTIVE')
      throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_CONNECTION_NOT_ACTIVE',
        message:'Merchant account is disabled; manual reconciliation required.'});
    if(!payment.merchantBindingHash||!/^[a-f0-9]{64}$/.test(payment.merchantBindingHash))
      throw new ApplicationError({category:'CONFLICT',code:'PAYMENT_HISTORICAL_BINDING_MISMATCH',
        message:'Historical payment requires independently verified merchant binding.'});
    if(merchantConnectionBindingHash(active)===payment.merchantBindingHash)
      return (await this.resolve(payment.tenantId,provider)).provider;
    const original=await this.connections.findGenerationByBinding?.(
      payment.tenantId,provider,payment.merchantBindingHash);
    if(!original||merchantConnectionBindingHash(original)!==payment.merchantBindingHash||
      !this.createAdapter)
      throw new ApplicationError({category:'CONFLICT',code:'PAYMENT_HISTORICAL_BINDING_MISMATCH',
        message:'Original payment account cannot be verified; manual reconciliation required.'});
    if(!isPinnedHistoricalVaultReference(original.credentialRef))
      throw new ApplicationError({category:'CONFLICT',code:'PAYMENT_HISTORICAL_CREDENTIAL_GENERATION_REQUIRED',
        message:'Mutable historical vault references cannot authorize payment reconciliation.'});
    // NEVER use a cached adapter keyed only by provider for historic charges.
    const adapter=await this.createAdapter(original);
    const bound=adapter as MercadoPagoPixProvider;
    if(adapter.id!==provider||bound.tenantId!==payment.tenantId||
      bound.recipientId!==original.recipientId)
      throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_RECIPIENT_MISMATCH',
        message:'Archived merchant recipient is not independently verifiable.'});
    return adapter;
  }
}
