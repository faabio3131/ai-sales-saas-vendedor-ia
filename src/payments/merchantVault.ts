import {applicationDefault} from 'firebase-admin/app';
import {ApplicationError} from '../infrastructure/errors';
import type {MerchantProviderConnection} from './connections';
import type {PaymentProviderId} from './providerCatalog';

export interface MerchantBankSecrets {
 tenantId:string;providerId:PaymentProviderId;recipientId:string;
 pixKey?:string;clientId?:string;clientSecret?:string;
 clientCertificatePem?:string;clientPrivateKeyPem?:string;
 apiKey?:string;applicationKey?:string;customerMap?:Record<string,string>;
}
/** Fetch per-merchant credentials from GCP Secret Manager via workload identity. */
export class GoogleSecretManagerMerchantVault {
 constructor(private readonly fetchImpl:typeof fetch=fetch){}
 async load(connection:MerchantProviderConnection):Promise<MerchantBankSecrets> {
  const ref=connection.credentialRef;
  if(!ref||!/^projects\/[a-zA-Z0-9_-]{4,80}\/secrets\/[a-zA-Z0-9_-]{1,200}\/versions\/(?:latest|[1-9][0-9]*)$/.test(ref)) {
   throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_VAULT_REFERENCE_INVALID',message:'Invalid merchant credential reference.'});
  }
  if(connection.status!=='ACTIVE'||!connection.recipientId) {
   throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_CONNECTION_NOT_ACTIVE',message:'Merchant connection inactive.'});
  }
  let token:string;
  try {
   const credentials=applicationDefault();
   token=(await credentials.getAccessToken()).access_token;
  } catch {
   throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_VAULT_AUTH_FAILED',message:'Merchant credential access unavailable.'});
  }
  const url='https://secretmanager.googleapis.com/v1/'+ref+':access';
  let response:Response;
  try {response=await this.fetchImpl(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});}
  catch {throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_VAULT_UNAVAILABLE',message:'Merchant credential access unavailable.'});}
  if(!response.ok) throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_VAULT_DENIED',message:'Merchant credential access denied.'});
  const json=await response.json() as {payload?:{data?:string}};
  if(typeof json.payload?.data!=='string')throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_VAULT_INVALID',message:'Merchant credential payload is invalid.'});
  let value:unknown;
  try {value=JSON.parse(Buffer.from(json.payload.data,'base64').toString('utf8'));}
  catch {throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_VAULT_INVALID',message:'Merchant credential payload is invalid.'});}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApplicationError({category:'PROVIDER',code:'PAYMENT_VAULT_INVALID',message:'Merchant credential payload is invalid.'});
  const bank=value as MerchantBankSecrets;
  if(bank.tenantId!==connection.tenantId||bank.providerId!==connection.providerId||
    bank.recipientId!==connection.recipientId) {
   throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_VAULT_BINDING_MISMATCH',message:'Merchant credentials do not match the active connection.'});
  }
  return bank;
 }
}
