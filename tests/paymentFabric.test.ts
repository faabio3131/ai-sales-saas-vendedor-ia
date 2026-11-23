import {describe,it,expect} from 'vitest';
import {InMemoryMerchantProviderConnectionRepository,MerchantPaymentConnectionsService} from '../src/payments/connections';
import {TenantPaymentProviderResolver,merchantConnectionBindingHash,isPinnedHistoricalVaultReference} from '../src/payments/resolver';
import {paymentVaultReference} from '../src/payments/merchantLifecycle';
import {PAYMENT_PROVIDER_CATALOG} from '../src/payments/providerCatalog';
import {PaymentProviderInterface} from '../src/payments/contracts';
const repo=new InMemoryMerchantProviderConnectionRepository([
  {tenantId:'pizza',providerId:'MERCADOPAGO',status:'ACTIVE',recipientId:'holder-a',credentialRef:'secret/pizza/mp'},
  {tenantId:'other',providerId:'MERCADOPAGO',status:'DISABLED',recipientId:'holder-b',credentialRef:'secret/other/mp'},
]);
const adapter={id:'MERCADOPAGO',tenantId:'pizza',recipientId:'holder-a'} as unknown as PaymentProviderInterface;
const resolver=new TenantPaymentProviderResolver(repo,new Map([['MERCADOPAGO',adapter]]));
const owner={tenantId:'pizza',role:'OWNER',requestId:'1'};
describe('Tenant-bound multi-PSP payment fabric',()=>{
 it('makes no unsupported provider available for use',()=>{
   expect(PAYMENT_PROVIDER_CATALOG.length).toBe(12);
   expect(PAYMENT_PROVIDER_CATALOG.filter(p=>p.status==='ADAPTER_IMPLEMENTED').map(p=>p.id)).toEqual(['MERCADOPAGO','EFI','ASAAS','PAGARME','BANCO_INTER','BANCO_DO_BRASIL','PAGBANK']);
 });
 it('fails closed without a selected or active provider',async()=>{
   await expect(resolver.forNewPayment('pizza')).rejects.toMatchObject({code:'PAYMENT_PROVIDER_SELECTION_REQUIRED'});
   await expect(resolver.forNewPayment('other','MERCADOPAGO')).rejects.toMatchObject({code:'PAYMENT_CONNECTION_NOT_ACTIVE'});
   await expect(resolver.forNewPayment('pizza','BANCO_INTER')).rejects.toMatchObject({code:'PAYMENT_CONNECTION_NOT_ACTIVE'});
 });
 it('allows owner preference while hiding credentials from tenant API',async()=>{
   const service=new MerchantPaymentConnectionsService(repo);
   await expect(service.setPreference({...owner,role:'STAFF'},{providerId:'MERCADOPAGO'})).rejects.toMatchObject({code:'PAYMENT_OWNER_REQUIRED'});
   await expect(service.setPreference(owner,{providerId:'MERCADOPAGO',status:'ACTIVE'})).rejects.toMatchObject({code:'PAYMENT_PROVIDER_INVALID'});
   await service.setPreference(owner,{providerId:'MERCADOPAGO'});
   const overview=await service.overview(owner);
   expect(overview.preference).toBe('MERCADOPAGO');
   expect(JSON.stringify(overview)).not.toContain('secret/pizza/mp');
   expect((await resolver.forNewPayment('pizza')).id).toBe('MERCADOPAGO');
 });
 it('pins the recorded provider and recipient/credential version without persisting a vault path',async()=>{
   const selection=await resolver.forNewPaymentWithBinding('pizza','MERCADOPAGO');
   expect(selection.bindingHash).toMatch(/^[a-f0-9]{64}$/);
   const recorded={tenantId:'pizza',provider:'MERCADOPAGO',merchantBindingHash:selection.bindingHash} as never;
   expect(await resolver.forRecordedPayment(recorded)).toBe(adapter);
   await expect(resolver.forRecordedPayment({tenantId:'pizza',provider:'MERCADOPAGO'} as never))
     .rejects.toMatchObject({code:'PAYMENT_HISTORICAL_BINDING_MISMATCH'});
   const old=repo.connections[0];
   try{
    repo.connections[0]={...old,credentialRef:'secret/pizza/replaced'};
    await expect(resolver.forRecordedPayment(recorded))
      .rejects.toMatchObject({code:'PAYMENT_HISTORICAL_BINDING_MISMATCH'});
   }finally{repo.connections[0]=old;}
 });
 it('recovers only a numerically pinned vault generation, never a mutable alias',async()=>{
   const previous=repo.connections[0];
   const pinned={...previous,credentialRef:'projects/merchant-prod/secrets/avpay-account/versions/6',version:6};
   repo.connections[0]=pinned;
   const originalBinding=(await resolver.forNewPaymentWithBinding('pizza','MERCADOPAGO')).bindingHash;
   const archivedPayment={tenantId:'pizza',provider:'MERCADOPAGO',merchantBindingHash:originalBinding} as never;
   repo.generations.set(originalBinding,pinned);
   try{
    repo.connections[0]={...previous,recipientId:'holder-new',credentialRef:'projects/merchant-prod/secrets/avpay-account/versions/7',version:7};
    const currentAdapter={...adapter,recipientId:'holder-new'} as unknown as PaymentProviderInterface;
    const historyResolver=new TenantPaymentProviderResolver(repo,new Map([['MERCADOPAGO',currentAdapter]]),
      async connection=>({id:connection.providerId,tenantId:connection.tenantId,
        recipientId:connection.recipientId} as unknown as PaymentProviderInterface));
    const recovered=await historyResolver.forRecordedPayment(archivedPayment);
    expect((recovered as unknown as {recipientId:string}).recipientId).toBe('holder-a');
    repo.generations.delete(originalBinding);
    await expect(historyResolver.forRecordedPayment(archivedPayment))
      .rejects.toMatchObject({code:'PAYMENT_HISTORICAL_BINDING_MISMATCH'});
    const mutable={...pinned,credentialRef:'projects/merchant-prod/secrets/avpay-account/versions/latest'};
    const mutableHash=merchantConnectionBindingHash(mutable);
    repo.generations.set(mutableHash,mutable);
    await expect(historyResolver.forRecordedPayment({tenantId:'pizza',provider:'MERCADOPAGO',merchantBindingHash:mutableHash} as never))
      .rejects.toMatchObject({code:'PAYMENT_HISTORICAL_CREDENTIAL_GENERATION_REQUIRED'});
    repo.generations.delete(mutableHash);
   }finally{
    repo.connections[0]=previous;
    repo.generations.delete(originalBinding);
   }
 });
 it('supports numbered operations-only secret versions and rejects overwritable historical paths',()=>{
   expect(paymentVaultReference('pizza','MERCADOPAGO','GOOGLE','merchant-prod',6)).toMatch(/\/versions\/6$/);
   expect(isPinnedHistoricalVaultReference('projects/merchant-prod/secrets/secure-vault/versions/6')).toBe(true);
   expect(isPinnedHistoricalVaultReference('projects/merchant-prod/secrets/secure-vault/versions/latest')).toBe(false);
   expect(isPinnedHistoricalVaultReference('mounted:aabbcc')).toBe(false);
   expect(()=>paymentVaultReference('pizza','MERCADOPAGO','GOOGLE','merchant-prod',0))
     .toThrowError(expect.objectContaining({code:'PAYMENT_SECRET_VERSION_INVALID'}));
   expect(()=>paymentVaultReference('pizza','MERCADOPAGO','MOUNTED',undefined,2))
     .toThrowError(expect.objectContaining({code:'PAYMENT_MOUNT_SECRET_VERSION_UNSUPPORTED'}));
 });
 it('never switches a recorded payment to another provider',async()=>{
   await expect(resolver.forRecordedPayment({tenantId:'pizza',provider:'BANCO_INTER'} as never)).rejects.toMatchObject({code:'PAYMENT_CONNECTION_NOT_ACTIVE'});
 });
 it('checks recipient and tenant identity against adapter',async()=>{
   const broken=new TenantPaymentProviderResolver(repo,new Map([['MERCADOPAGO',{id:'MERCADOPAGO',tenantId:'pizza',recipientId:'wrong'} as never]]));
   await expect(broken.forNewPayment('pizza','MERCADOPAGO')).rejects.toMatchObject({code:'PAYMENT_RECIPIENT_MISMATCH'});
 });
});
