import {describe,it,expect} from 'vitest';
import {retailFiscalIntent,bookingFiscalIntent} from '../src/fiscal/multisectorIntents';
import type {RetailOrder} from '../src/retail/model';
import type {Booking} from '../src/scheduling/model';

const retail=():RetailOrder=>({
 tenantId:'tenant-a',unitId:'store-a',id:'order-1',version:5,catalogVersion:3,
 customerId:'customer-a',status:'COMPLETED',currency:'BRL',totalMinor:5000,
 lines:[{itemId:'i',sku:'sku-1',name:'A',quantity:2,unitPriceMinor:2500,totalMinor:5000,trackStock:false}],
 payment:{method:'PIX',provider:'ASAAS',providerPaymentId:'p1',state:'VERIFIED',
  merchantBindingHash:'a'.repeat(64),verifiedAt:'2026-11-01T10:00:00.000Z'},
 createdAt:'2026-11-01T09:00:00.000Z',updatedAt:'2026-11-01T10:00:00.000Z',
 completedAt:'2026-11-01T10:00:00.000Z',actorId:'admin',acceptedTotalMinor:5000,
});
const booking=():Booking=>({
 tenantId:'tenant-a',unitId:'salon-a',id:'booking-1',version:3,configVersion:2,
 customerId:'customer-a',serviceId:'service-a',professionalId:'pro-a',
 resourceIds:[],startMs:1761991200000,endMs:1761994800000,timezone:'America/Sao_Paulo',
 status:'COMPLETED',holdUntilMs:0,deposit:{amountMinor:1000,currency:'BRL',status:'CONFIRMED'},
 pack:{kind:'SALON',cancelNoticeMinutes:10,noShowGraceMinutes:5,notifyWhatsApp:false,
  configVersion:2,priceMinor:8000,acceptedAt:'2026-11-01T08:00:00.000Z',acceptedBy:'owner'},
 createdAt:'2026-11-01T08:00:00.000Z',updatedAt:'2026-11-01T10:00:00.000Z',
 createdBy:'owner',transitionBy:'owner',
});
describe('T13.5 NFCore commercial fiscal contract boundary',()=>{
 it('retail PSP settlement emits only a classified-source candidate, never a fiscal document',()=>{
  const i=retailFiscalIntent(retail());
  expect(i).toMatchObject({sourceDomain:'RETAIL',grossAmountMinor:5000,
   paymentCoverage:'FULL_VALUE',settlementEvidence:'PSP_VERIFIED',
   classificationState:'PENDING_FISCAL_CLASSIFICATION',
   automaticIssuanceAuthorized:false,externalFiscalDocumentId:null});
  expect(i.eligibleDocumentKinds).toEqual(['nfce','nfe']);
  expect(retailFiscalIntent(retail()).id).toBe(i.id);
  expect(retailFiscalIntent({...retail(),tenantId:'tenant-b'}).id).not.toBe(i.id);
 });
 it('manual checkout is an operator report, not bank verified',()=>{
  const i=retailFiscalIntent({...retail(),payment:{state:'MANUAL_RECORDED',method:'CASH'}});
  expect(i.settlementEvidence).toBe('OPERATOR_RECORDED');
  expect(i.classificationState).toBe('BLOCKED_MANUAL_SETTLEMENT_REVIEW');
 });
 it('rejects inconsistent retail totals even if the payment flag says verified',()=>{
  expect(()=>retailFiscalIntent({...retail(),totalMinor:1000}))
   .toThrowError(expect.objectContaining({code:'FISCAL_INTENT_SOURCE_INVALID'}));
 });
 it('service deposit is never falsely treated as full settlement or NFSe authorized',()=>{
  const i=bookingFiscalIntent(booking());
  expect(i.eligibleDocumentKinds).toEqual(['nfse']);
  expect(i.paymentCoverage).toBe('PARTIAL_DEPOSIT');
  expect(i.settlementEvidence).toBe('DEPOSIT_ONLY');
  expect(i.grossAmountMinor).toBe(8000);
  expect(i.automaticIssuanceAuthorized).toBe(false);
  expect(i.classificationState).toBe('BLOCKED_SERVICE_NFSE_CONTRACT');
 });
 it('unpriced service reports explicit missing evidence instead of fabricating zero',()=>{
  const b=booking();
  const i=bookingFiscalIntent({...b,pack:undefined});
  expect(i.grossAmountMinor).toBeNull();
  expect(i.classificationState).toBe('BLOCKED_AMOUNT_INTEGRITY');
 });
});