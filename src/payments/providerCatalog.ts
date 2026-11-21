/** Candidate providers are not represented as ready-for-use integrations. */
export type PaymentProviderId='MERCADOPAGO'|'EFI'|'ASAAS'|'PAGARME'|'BANCO_INTER'|'BANCO_DO_BRASIL'|'PAGBANK'|'STONE'|'SICOOB'|'SICREDI'|'SANTANDER'|'ITAU';
export interface ProviderDescriptor {
  id:PaymentProviderId;
  displayName:string;
  kind:'BANK'|'PSP';
  status:'ADAPTER_IMPLEMENTED'|'CONTRACT_PENDING'|'PLANNED';
}
export const PAYMENT_PROVIDER_CATALOG:ReadonlyArray<ProviderDescriptor>=[
  {id:'MERCADOPAGO',displayName:'Mercado Pago',kind:'PSP',status:'ADAPTER_IMPLEMENTED'},
  {id:'EFI',displayName:'Efí',kind:'PSP',status:'ADAPTER_IMPLEMENTED'},
  {id:'ASAAS',displayName:'Asaas',kind:'PSP',status:'ADAPTER_IMPLEMENTED'},
  {id:'PAGARME',displayName:'Pagar.me',kind:'PSP',status:'ADAPTER_IMPLEMENTED'},
  {id:'BANCO_INTER',displayName:'Banco Inter',kind:'BANK',status:'ADAPTER_IMPLEMENTED'},
  {id:'BANCO_DO_BRASIL',displayName:'Banco do Brasil',kind:'BANK',status:'ADAPTER_IMPLEMENTED'},
  {id:'PAGBANK',displayName:'PagBank',kind:'PSP',status:'ADAPTER_IMPLEMENTED'},
  {id:'STONE',displayName:'Stone',kind:'PSP',status:'PLANNED'},
  {id:'SICOOB',displayName:'Sicoob',kind:'BANK',status:'PLANNED'},
  {id:'SICREDI',displayName:'Sicredi',kind:'BANK',status:'PLANNED'},
  {id:'SANTANDER',displayName:'Santander',kind:'BANK',status:'CONTRACT_PENDING'},
  {id:'ITAU',displayName:'Itaú',kind:'BANK',status:'CONTRACT_PENDING'},
];
export const providerDescriptor=(id:string)=>PAYMENT_PROVIDER_CATALOG.find(item=>item.id===id);
