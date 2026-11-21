import {describe,it,expect} from 'vitest';
import {InMemoryMerchantProviderConnectionRepository,MerchantPaymentConnectionsService} from '../src/payments/connections';
import {TenantPaymentProviderResolver} from '../src/payments/resolver';
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
 it('never switches a recorded payment to another provider',async()=>{
   await expect(resolver.forRecordedPayment({tenantId:'pizza',provider:'BANCO_INTER'} as never)).rejects.toMatchObject({code:'PAYMENT_CONNECTION_NOT_ACTIVE'});
 });
 it('checks recipient and tenant identity against adapter',async()=>{
   const broken=new TenantPaymentProviderResolver(repo,new Map([['MERCADOPAGO',{id:'MERCADOPAGO',tenantId:'pizza',recipientId:'wrong'} as never]]));
   await expect(broken.forNewPayment('pizza','MERCADOPAGO')).rejects.toMatchObject({code:'PAYMENT_RECIPIENT_MISMATCH'});
 });
});
