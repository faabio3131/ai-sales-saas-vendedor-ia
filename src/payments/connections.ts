import {getApps,initializeApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {ApplicationError} from '../infrastructure/errors';
import type {TenantContext} from '../types/contracts';
import {providerDescriptor,PaymentProviderId} from './providerCatalog';

export interface MerchantProviderConnection {
  tenantId:string;
  providerId:PaymentProviderId;
  status:'PENDING_VERIFICATION'|'ACTIVE'|'DISABLED';
  recipientId?:string;
  credentialRef?:string; // secure secret-manager reference, not the credential
  version?:number; // merchant lifecycle CAS version; included in historical binding
}
export interface TenantProviderPreferences {
  tenantId:string;
  preferredProviderId?:PaymentProviderId;
  updatedAt?:string;
}
export interface MerchantProviderConnectionRepository {
  get(tenantId:string,providerId:PaymentProviderId):Promise<MerchantProviderConnection|null>;
  list(tenantId:string):Promise<MerchantProviderConnection[]>;
  preferences(tenantId:string):Promise<TenantProviderPreferences>;
  setPreference(tenantId:string,providerId:PaymentProviderId):Promise<TenantProviderPreferences>;
}
function db() {
  if(!getApps().length) {const projectId=process.env.FIREBASE_PROJECT_ID;initializeApp(projectId?{projectId}:undefined);}
  return getFirestore();
}
export class FirestoreMerchantProviderConnectionRepository implements MerchantProviderConnectionRepository {
  async get(tenantId:string,providerId:PaymentProviderId) {
    const snapshot=await db().collection('merchantPaymentConnections').doc(tenantId+'__'+providerId).get();
    const data=snapshot.data() as MerchantProviderConnection|undefined;
    return data?.tenantId===tenantId&&data.providerId===providerId?data:null;
  }
  async list(tenantId:string) {
    const s=await db().collection('merchantPaymentConnections').where('tenantId','==',tenantId).get();
    return s.docs.map(d=>d.data() as MerchantProviderConnection).filter(x=>x.tenantId===tenantId);
  }
  async preferences(tenantId:string) {
    const doc=await db().collection('merchantPaymentPreferences').doc(tenantId).get();
    const data=doc.data() as TenantProviderPreferences|undefined;
    return data?.tenantId===tenantId?data:{tenantId};
  }
  async setPreference(tenantId:string,providerId:PaymentProviderId) {
    const data={tenantId,preferredProviderId:providerId,updatedAt:new Date().toISOString()};
    await db().collection('merchantPaymentPreferences').doc(tenantId).set(data);
    return data;
  }
}
export class InMemoryMerchantProviderConnectionRepository implements MerchantProviderConnectionRepository {
  constructor(public readonly connections:MerchantProviderConnection[] = []){}
  private readonly prefs=new Map<string,TenantProviderPreferences>();
  async get(tenantId:string,providerId:PaymentProviderId) {
    return this.connections.find(c=>c.tenantId===tenantId&&c.providerId===providerId)??null;
  }
  async list(tenantId:string){return this.connections.filter(c=>c.tenantId===tenantId);}
  async preferences(tenantId:string){return this.prefs.get(tenantId)??{tenantId};}
  async setPreference(tenantId:string,providerId:PaymentProviderId){
    const data={tenantId,preferredProviderId:providerId,updatedAt:new Date().toISOString()};
    this.prefs.set(tenantId,data);return data;
  }
}
export class MerchantPaymentConnectionsService {
  constructor(private readonly repo:MerchantProviderConnectionRepository){}
  private tenant(context:TenantContext):string {
    if(!context.tenantId?.trim()) throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_TENANT_REQUIRED',message:'Authorized tenant required.'});
    return context.tenantId;
  }
  async overview(context:TenantContext) {
    const tenantId=this.tenant(context);
    const [connections,pref]=await Promise.all([this.repo.list(tenantId),this.repo.preferences(tenantId)]);
    // NEVER include secret or vault references in API responses.
    return {preference:pref.preferredProviderId,connections:connections.map(c=>({
      providerId:c.providerId,status:c.status,recipientConfigured:Boolean(c.recipientId),
      credentialConfigured:Boolean(c.credentialRef),
    }))};
  }
  async setPreference(context:TenantContext,payload:unknown) {
    if(context.role!=='OWNER') throw new ApplicationError({category:'FORBIDDEN',code:'PAYMENT_OWNER_REQUIRED',message:'Owner authorization required.'});
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||
      Object.keys(payload).length!==1 || !('providerId' in payload) ||
      typeof payload.providerId!=='string' || providerDescriptor(payload.providerId)?.status!=='ADAPTER_IMPLEMENTED') {
      throw new ApplicationError({category:'VALIDATION',code:'PAYMENT_PROVIDER_INVALID',message:'Invalid provider selection.'});
    }
    const tenantId=this.tenant(context);
    const providerId=payload.providerId as PaymentProviderId;
    return this.repo.setPreference(tenantId,providerId);
  }
}
