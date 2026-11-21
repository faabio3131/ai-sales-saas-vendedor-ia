import {describe,it,expect} from 'vitest';
import {PixCobBankProvider} from '../src/payments/pixCobBanks';
import {PAYMENT_PROVIDER_CATALOG} from '../src/payments/providerCatalog';
import {bankEndpoints} from '../src/payments/bankTransport';

describe('Santander and Itau Pix Cob contract preparation',()=>{
 it.each(['SANTANDER','ITAU'] as const)('%s normalizes Pix Cob with a trusted mock, but cannot be activated without a verified bank transport',async bank=>{
  let id='';
  const adapter=new PixCobBankProvider({
   bank,tenantId:'restaurant',recipientId:'merchant-bank-verified',pixKey:'registered-pix-key',
   request:async(path,method,body)=>{
    if(method==='PUT'){id=path.split('/').pop()??'';expect(body?.valor).toEqual({original:'49.90'});}
    return {txid:id,status:'ATIVA',valor:{original:'49.90'},solicitacaoPagador:'restaurant:quote-1',pixCopiaECola:'000201'};
   },
  });
  const payment=await adapter.createPix({tenantId:'restaurant',customerId:'c1',referenceId:'quote-1',
   amountMinor:4990,currency:'BRL',idempotencyKey:'idem'});
  expect(payment).toMatchObject({provider:bank,status:'PENDING',referenceId:'restaurant:quote-1',amountMinor:4990});
  expect(PAYMENT_PROVIDER_CATALOG.find(p=>p.id===bank)?.status).toBe('CONTRACT_PENDING');
  expect(()=>bankEndpoints(bank)).toThrowError();
 });
});
