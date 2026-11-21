import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import type {MerchantCustomerMapRepository} from './adapterFactory';
export class FirestoreMerchantCustomerMap implements MerchantCustomerMapRepository {
 async resolve(tenantId:string,providerId:string,customerId:string):Promise<string|null> {
  if(!tenantId||!providerId||!customerId)return null;
  if(!getApps().length)initializeApp(process.env.FIREBASE_PROJECT_ID?{projectId:process.env.FIREBASE_PROJECT_ID}:undefined);
  const snapshot=await getFirestore().collection('merchantProviderCustomers')
   .doc([tenantId,providerId,customerId].map(encodeURIComponent).join('__')).get();
  const record=snapshot.data();
  if(record?.tenantId!==tenantId||record?.providerId!==providerId||record?.customerId!==customerId||
    typeof record?.providerCustomerId!=='string')return null;
  return record.providerCustomerId;
 }
}
