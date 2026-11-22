import {FirestorePaymentRepository,FirestorePaymentWebhookEventRepository} from './firestoreRepository';
import {createOrderPaymentRuntime} from '../orderPayments/runtime';
import {FirestoreMerchantProviderConnectionRepository} from './connections';
import {GoogleSecretManagerMerchantVault} from './merchantVault';
import {MountedMerchantCredentialsVault} from './mountedVault';
import {MerchantPaymentAdapterFactory} from './adapterFactory';
import {FirestoreMerchantCustomerMap} from './customerMap';
import {TenantPaymentProviderResolver} from './resolver';
import {FirestoreQuoteItemRepository,FirestoreQuoteRepository} from '../quotes/firestoreRepository';
import {FirestoreSalesFiscalHandoffRepository} from '../fiscal/firestoreRepository';
import {SalesFiscalHandoffService} from '../fiscal/service';
import {StructuralPaymentProvider} from './provider';
import {PaymentService} from './service';
import {FirestoreVerifiedWebhookLedger} from './webhookLedger';
import {FirestoreMultisectorWebhookService} from './multisectorWebhook';

export function createBankPaymentRuntime(){
 const payments=new FirestorePaymentRepository();
 const connections=new FirestoreMerchantProviderConnectionRepository();
 const vault=process.env.PAYMENT_VAULT_BACKEND==='MOUNTED'
  ? new MountedMerchantCredentialsVault():new GoogleSecretManagerMerchantVault();
 const factory=new MerchantPaymentAdapterFactory(vault,new FirestoreMerchantCustomerMap());
 const resolver=new TenantPaymentProviderResolver(connections,new Map(),conn=>factory.build(conn));
 const quotes=new FirestoreQuoteRepository();
 const fiscal=new SalesFiscalHandoffService(new FirestoreSalesFiscalHandoffRepository(),quotes,
  new FirestoreQuoteItemRepository());
 const service=new PaymentService(payments,new FirestorePaymentWebhookEventRepository(),
  quotes,new StructuralPaymentProvider(),fiscal,undefined,resolver);
 const orderRuntime=createOrderPaymentRuntime();
 return {payments,connections,vault,resolver,service,audit:new FirestoreVerifiedWebhookLedger(),
  orderPayments:orderRuntime.store,orderService:orderRuntime.service,
  multisector:new FirestoreMultisectorWebhookService(resolver)};
}
