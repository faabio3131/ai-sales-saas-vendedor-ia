import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {getFirestore} from 'firebase-admin/firestore';
import type {MerchantCustomerMapRepository} from './adapterFactory';
import type {PagBankCustomer} from './pagbank';
export class FirestoreMerchantCustomerMap implements MerchantCustomerMapRepository {
 async resolvePagBankCustomer(tenantId:string,customerId:string):Promise<PagBankCustomer|null>{
  if(!tenantId||!customerId)return null;
  ensureFirebaseAdminApp();
  const doc=await getFirestore(ensureFirebaseAdminApp()).collection('merchantCustomerBillingProfiles')
   .doc([tenantId,customerId].map(encodeURIComponent).join('__')).get();
  const x=doc.data();
  if(x?.tenantId!==tenantId||x?.customerId!==customerId||!x?.pagbank)return null;
  return x.pagbank as PagBankCustomer;
 }

 async resolve(tenantId:string,providerId:string,customerId:string):Promise<string|null> {
  if(!tenantId||!providerId||!customerId)return null;
  ensureFirebaseAdminApp();
  const snapshot=await getFirestore(ensureFirebaseAdminApp()).collection('merchantProviderCustomers')
   .doc([tenantId,providerId,customerId].map(encodeURIComponent).join('__')).get();
  const record=snapshot.data();
  if(record?.tenantId!==tenantId||record?.providerId!==providerId||record?.customerId!==customerId||
    typeof record?.providerCustomerId!=='string')return null;
  return record.providerCustomerId;
 }
}
