import {describe,it,expect,vi} from 'vitest';
import {MerchantProviderOnboardingService,paymentVaultReference,
 type MerchantLifecycleStore,type ManagedMerchantConnection} from '../src/payments/merchantLifecycle';
import type {MerchantCredentialsVault} from '../src/payments/merchantVault';
import type {TenantContext} from '../src/types/contracts';
const owner=(tenantId='tenant-a',role='OWNER'):TenantContext=>({tenantId,role,userId:'owner-'+tenantId,requestId:'t08-2-test'});
class Store implements MerchantLifecycleStore{
 readonly entries=new Map<string,ManagedMerchantConnection>();
 async get(t:string,p:string){return this.entries.get(t+'|'+p)??null;}
 async write(next:ManagedMerchantConnection,expected:number){
  const key=next.tenantId+'|'+next.providerId,old=this.entries.get(key);
  if((old?.version??0)!==expected||next.version!==expected+1)throw new Error('conflict');
  this.entries.set(key,structuredClone(next));
 }
}
const fakeVault:MerchantCredentialsVault={load:vi.fn(async()=>{throw new Error('Never access secret on enrollment');})};
const service=(store=new Store(),verified=false)=>{
 const verifier=vi.fn(async()=>({verified,evidenceRef:'external:provider-test-proof-2026'}));
 return {store,verifier,api:new MerchantProviderOnboardingService(store,fakeVault,{verify:verifier})};
};
describe('T08.2 — tenant-safe multibank provisioning',()=>{
 it('generates a deterministic, isolated private-vault reference and rejects arbitrary project',()=>{
  const a=paymentVaultReference('merchant-a','EFI','MOUNTED');
  const b=paymentVaultReference('merchant-b','EFI','MOUNTED');
  expect(a).toMatch(/^mounted:[a-f0-9]{64}$/);
  expect(a).not.toBe(b);
  expect(paymentVaultReference('merchant-a','EFI','GOOGLE','proj-test-01'))
   .toMatch(/^projects\/proj-test-01\/secrets\/avpay-[a-f0-9]{48}\/versions\/latest$/);
  expect(()=>paymentVaultReference('merchant-a','EFI','GOOGLE','other/project')).toThrow();
 });
 it('enrolls an owner without raw credentials, without activation or live payment',async()=>{
  const {store,api}=service();
  const result=await api.enroll(owner(),{providerId:'EFI',recipientId:'pix-recipient'});
  expect(result).toEqual({providerId:'EFI',status:'PENDING_VERIFICATION',
   recipientConfigured:true,credentialConfigured:false});
  expect((await store.get('tenant-a','EFI'))).toMatchObject({tenantId:'tenant-a',
   recipientId:'pix-recipient',status:'PENDING_VERIFICATION',version:1});
  expect((await store.get('tenant-a','EFI'))?.credentialRef).toBeUndefined();
  expect(fakeVault.load).not.toHaveBeenCalled();
 });
 it('uses independent records per tenant and for every eligible PSP',async()=>{
  const {store,api}=service();
  for(const p of ['EFI','ASAAS','PAGARME','BANCO_INTER','BANCO_DO_BRASIL','PAGBANK','MERCADOPAGO'])
   await api.enroll(owner('tenant-a'),{providerId:p,recipientId:'account-'+p});
  await api.enroll(owner('tenant-b'),{providerId:'EFI',recipientId:'account-different'});
  expect(store.entries.size).toBe(8);
  expect((await store.get('tenant-a','EFI'))?.recipientId).toBe('account-EFI');
  expect((await store.get('tenant-b','EFI'))?.recipientId).toBe('account-different');
 });
 it('refuses nonowner, unknown provider, unsupported provider, injected secret and forged tenant',async()=>{
  const {api,store}=service();
  await expect(api.enroll(owner('tenant-a','STAFF'),{providerId:'EFI',recipientId:'rec-abc'}))
   .rejects.toMatchObject({code:'PAYMENT_OWNER_REQUIRED'});
  for(const p of ['STONE','SANTANDER','ITAU','INVALID']){
   await expect(api.enroll(owner(),{providerId:p,recipientId:'rec-abc'}))
    .rejects.toMatchObject({code:'PAYMENT_PROVIDER_NOT_AVAILABLE'});
  }
  await expect(api.enroll(owner(),{providerId:'EFI',recipientId:'rec-abc',
   credentialRef:'projects/evil/secrets/x/versions/latest'}))
   .rejects.toMatchObject({code:'PAYMENT_CONNECTION_REQUEST_INVALID'});
  await expect(api.enroll(owner(),{providerId:'EFI',recipientId:'rec-abc',tenantId:'tenant-b'}))
   .rejects.toMatchObject({code:'PAYMENT_CONNECTION_REQUEST_INVALID'});
  expect(store.entries.size).toBe(0);
 });
 it('retains idempotent pending enrollment but revokes stale vault ref when recipient changes',async()=>{
  const {api,store}=service();
  const payload={providerId:'EFI',recipientId:'account-one'};
  await api.enroll(owner(),payload);
  await api.attachVault('tenant-a','EFI','MOUNTED');
  expect((await store.get('tenant-a','EFI'))?.credentialRef).toMatch(/^mounted:/);
  expect(await api.enroll(owner(),payload)).toMatchObject({credentialConfigured:true});
  const changed=await api.enroll(owner(),{providerId:'EFI',recipientId:'account-two'});
  expect(changed).toMatchObject({credentialConfigured:false});
  expect((await store.get('tenant-a','EFI'))?.credentialRef).toBeUndefined();
 });
 it('never activates without independent proof even after staging vault',async()=>{
  const {api,store}=service();
  await api.enroll(owner(),{providerId:'ASAAS',recipientId:'recipient-01'});
  await expect(api.verifyAndActivate('tenant-a','ASAAS'))
   .rejects.toMatchObject({code:'PAYMENT_CONNECTION_NOT_PROVISIONED'});
  await api.attachVault('tenant-a','ASAAS','MOUNTED');
  await expect(api.verifyAndActivate('tenant-a','ASAAS'))
   .rejects.toMatchObject({code:'PAYMENT_EXTERNAL_VERIFICATION_REQUIRED'});
  expect((await store.get('tenant-a','ASAAS'))?.status).toBe('PENDING_VERIFICATION');
 });
 it('requires scoped external proof to activate, then blocks owner re-enrollment',async()=>{
  const {store,api,verifier}=service(new Store(),true);
  await api.enroll(owner(),{providerId:'PAGARME',recipientId:'provider-recipient'});
  await api.attachVault('tenant-a','PAGARME','GOOGLE','test-project');
  await api.verifyAndActivate('tenant-a','PAGARME');
  expect(verifier).toHaveBeenCalledOnce();
  expect(await store.get('tenant-a','PAGARME')).toMatchObject({status:'ACTIVE',
   verificationEvidenceRef:'external:provider-test-proof-2026'});
  await expect(api.enroll(owner(),{providerId:'PAGARME',recipientId:'other-recipient'}))
   .rejects.toMatchObject({code:'PAYMENT_ACTIVE_CONNECTION_LOCKED'});
  await api.disable('tenant-a','PAGARME');
  expect((await store.get('tenant-a','PAGARME'))?.status).toBe('DISABLED');
 });
});
