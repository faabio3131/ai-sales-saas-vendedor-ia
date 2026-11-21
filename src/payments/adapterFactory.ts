import {ApplicationError} from '../infrastructure/errors';
import type {MerchantProviderConnection} from './connections';
import type {PaymentProviderInterface} from './contracts';
import type {MerchantCredentialsVault} from './merchantVault';
import {providerTransport} from './bankTransport';
import {PixCobBankProvider} from './pixCobBanks';
import {AsaasPixProvider} from './asaas';
import {PagarmePixProvider} from './pagarme';
import {PagBankPixProvider} from './pagbank';
import {MercadoPagoPixProvider} from './mercadoPago';
export interface MerchantCustomerMapRepository {
 resolve(tenantId:string,providerId:string,customerId:string):Promise<string|null>;
 resolvePagBankCustomer?(tenantId:string,customerId:string):Promise<import('./pagbank').PagBankCustomer|null>;
}
export class MerchantPaymentAdapterFactory {
 constructor(
  private readonly vault:MerchantCredentialsVault,
  private readonly customerMap:MerchantCustomerMapRepository,
 ){}
 async build(conn:MerchantProviderConnection):Promise<PaymentProviderInterface> {
  const secret=await this.vault.load(conn);
  const request=providerTransport(conn.providerId,secret);
  const resolveCustomer=(id:string)=>this.customerMap.resolve(conn.tenantId,conn.providerId,id);
  if(conn.providerId==='EFI'||conn.providerId==='BANCO_INTER'||conn.providerId==='BANCO_DO_BRASIL'){
   if(!secret.pixKey)return this.unconfigured();
   return new PixCobBankProvider({
    bank:conn.providerId,tenantId:conn.tenantId,recipientId:conn.recipientId!,
    pixKey:secret.pixKey,request});
  }
  if(conn.providerId==='ASAAS')return new AsaasPixProvider({
   tenantId:conn.tenantId,recipientId:conn.recipientId!,request,resolveCustomer});
  if(conn.providerId==='PAGARME')return new PagarmePixProvider({
   tenantId:conn.tenantId,recipientId:conn.recipientId!,request,resolveCustomer});
  if(conn.providerId==='PAGBANK')return new PagBankPixProvider({
    tenantId:conn.tenantId,recipientId:conn.recipientId!,request,
    resolveCustomer:async id=>this.customerMap.resolvePagBankCustomer?.(conn.tenantId,id)??null,
  });
  if(conn.providerId==='MERCADOPAGO'){
   if(!secret.apiKey||!secret.clientSecret)return this.unconfigured();
   return new MercadoPagoPixProvider({
    tenantId:conn.tenantId,collectorId:conn.recipientId!,accessToken:secret.apiKey,
    webhookSecret:secret.clientSecret,
   });
  }
  return this.unconfigured();
 }
 private unconfigured():never{
  throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_ADAPTER_NOT_CONFIGURED',message:'Provider credentials incomplete.'});
 }
}
