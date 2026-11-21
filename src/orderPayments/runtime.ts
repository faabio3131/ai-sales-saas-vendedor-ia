import { FirestoreOrderRepository } from '../orders/firestoreRepository';
import { FirestoreOrderPaymentRepository } from './firestoreRepository';
import { OrderPaymentService } from './service';
import { OrderPaymentPolicyEngine } from './policy';
import { FirestorePaymentMethodsRepository,PaymentMethodsService } from '../payments/methods';
import { FirestoreMerchantProviderConnectionRepository } from '../payments/connections';
import { MerchantPaymentAdapterFactory } from '../payments/adapterFactory';
import { GoogleSecretManagerMerchantVault } from '../payments/merchantVault';
import { MountedMerchantCredentialsVault } from '../payments/mountedVault';
import { FirestoreMerchantCustomerMap } from '../payments/customerMap';
import { TenantPaymentProviderResolver } from '../payments/resolver';

export function createOrderPaymentRuntime(){
  const store=new FirestoreOrderPaymentRepository();
  const connections=new FirestoreMerchantProviderConnectionRepository();
  const vault=process.env.PAYMENT_VAULT_BACKEND==='MOUNTED'?
    new MountedMerchantCredentialsVault():new GoogleSecretManagerMerchantVault();
  const factory=new MerchantPaymentAdapterFactory(vault,new FirestoreMerchantCustomerMap());
  const resolver=new TenantPaymentProviderResolver(connections,new Map(),
    connection=>factory.build(connection));
  const service=new OrderPaymentService(store,new FirestoreOrderRepository(),resolver,
    new PaymentMethodsService(new FirestorePaymentMethodsRepository()),
    new OrderPaymentPolicyEngine());
  return {store,service,connections,vault,resolver};
}
