import {createHash} from 'node:crypto';
import {ApplicationError} from '../infrastructure/errors';
import type {RetailOrder} from '../retail/model';
import type {Booking} from '../scheduling/model';

/** Source facts, NOT an NFCore issuance, a fiscal classification or a receipt. */
export interface MultisectorFiscalIntent {
 id:string;tenantId:string;unitId:string;
 sourceDomain:'RETAIL'|'SERVICE_BOOKING';sourceId:string;sourceVersion:number;
 sourceFingerprint:string;customerId:string;currency:'BRL';grossAmountMinor:number|null;
 settlementEvidence:'PSP_VERIFIED'|'OPERATOR_RECORDED'|'DEPOSIT_ONLY'|'UNVERIFIED';
 paymentCoverage:'FULL_VALUE'|'PARTIAL_DEPOSIT'|'UNKNOWN';
 eligibleDocumentKinds:readonly ('nfce'|'nfe'|'nfse')[];
 classificationState:'PENDING_FISCAL_CLASSIFICATION'|'BLOCKED_MANUAL_SETTLEMENT_REVIEW'|
 'BLOCKED_SERVICE_NFSE_CONTRACT'|'BLOCKED_AMOUNT_INTEGRITY';
 fiscalScopeBindingRequired:true;nfcoreCapabilityCheckRequired:true;
 automaticIssuanceAuthorized:false;externalFiscalDocumentId:null;
 sourceEventAt:string;
}
const hash=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
const safe=(amount:number)=>Number.isSafeInteger(amount)&&amount>=0;
function invalid(reason:string):never {
 throw new ApplicationError({category:'CONFLICT',code:'FISCAL_INTENT_SOURCE_INVALID',
  message:'Invalid fiscal event source: '+reason});
}
function canonicalId(domain:string,tenantId:string,unitId:string,id:string){
 return hash(['atendevende.t13.fiscal-intent.v1',domain,tenantId,unitId,id]);
}
export function retailFiscalIntent(order:RetailOrder):MultisectorFiscalIntent {
 if(order.status!=='COMPLETED'||!order.tenantId||!order.unitId||!order.id||!order.customerId||
  !Number.isSafeInteger(order.version)||order.version<1||!safe(order.totalMinor)||
  (order.acceptedTotalMinor!==undefined&&order.acceptedTotalMinor!==order.totalMinor))
  return invalid('retail completion not settled or amount inconsistent');
 if(order.lines.length===0||order.lines.some(l=>!safe(l.totalMinor)||!safe(l.unitPriceMinor)||
    !Number.isSafeInteger(l.quantity)||l.quantity<1||l.unitPriceMinor*l.quantity!==l.totalMinor))
  return invalid('retail item evidence invalid');
 const sum=order.lines.reduce((a,l)=>a+l.totalMinor,0);
 if(!safe(sum)||sum!==order.totalMinor)return invalid('retail item sum mismatch');
 const payment=order.payment.state;
 const evidence=payment==='VERIFIED'?'PSP_VERIFIED':
  payment==='MANUAL_RECORDED'?'OPERATOR_RECORDED':'UNVERIFIED';
 const paid=payment==='VERIFIED'||payment==='MANUAL_RECORDED';
 return {
  id:canonicalId('RETAIL',order.tenantId,order.unitId,order.id),
  tenantId:order.tenantId,unitId:order.unitId,sourceDomain:'RETAIL',
  sourceId:order.id,sourceVersion:order.version,
  sourceFingerprint:hash([order.catalogVersion,order.lines,order.totalMinor,order.payment,
    order.completedAt,order.acceptanceRef]),
  customerId:order.customerId,currency:'BRL',grossAmountMinor:order.totalMinor,
  settlementEvidence:evidence,
  paymentCoverage:paid?'FULL_VALUE':'UNKNOWN',
  eligibleDocumentKinds:['nfce','nfe'],
  classificationState:payment==='VERIFIED'?'PENDING_FISCAL_CLASSIFICATION':
   'BLOCKED_MANUAL_SETTLEMENT_REVIEW',
  fiscalScopeBindingRequired:true,nfcoreCapabilityCheckRequired:true,
  automaticIssuanceAuthorized:false,externalFiscalDocumentId:null,
  sourceEventAt:order.completedAt??order.updatedAt,
 };
}
export function bookingFiscalIntent(booking:Booking):MultisectorFiscalIntent {
 if(booking.status!=='COMPLETED'||!booking.tenantId||!booking.unitId||!booking.id||
  !booking.customerId||!Number.isSafeInteger(booking.version)||booking.version<1)
  return invalid('service completion not established');
 const amount=booking.pack?.priceMinor;
 if(amount!==undefined&&!safe(amount))return invalid('service price is invalid');
 if(!safe(booking.deposit.amountMinor))return invalid('service deposit invalid');
 const confirmedDeposit=booking.deposit.status==='CONFIRMED';
 // A deposit proves only the deposited amount, never the full service price.
 // NFS-e contract and classification must be independently authorized.
 return {
  id:canonicalId('SERVICE_BOOKING',booking.tenantId,booking.unitId,booking.id),
  tenantId:booking.tenantId,unitId:booking.unitId,sourceDomain:'SERVICE_BOOKING',
  sourceId:booking.id,sourceVersion:booking.version,
  sourceFingerprint:hash([booking.serviceId,booking.pack,booking.deposit,booking.completedAt,
    booking.checkedInAt]),
  customerId:booking.customerId,currency:'BRL',grossAmountMinor:amount??null,
  settlementEvidence:confirmedDeposit?'DEPOSIT_ONLY':'UNVERIFIED',
  paymentCoverage:confirmedDeposit?'PARTIAL_DEPOSIT':'UNKNOWN',
  eligibleDocumentKinds:['nfse'],
  classificationState:amount===undefined?'BLOCKED_AMOUNT_INTEGRITY':'BLOCKED_SERVICE_NFSE_CONTRACT',
  fiscalScopeBindingRequired:true,nfcoreCapabilityCheckRequired:true,
  automaticIssuanceAuthorized:false,externalFiscalDocumentId:null,
  sourceEventAt:booking.updatedAt,
 };
}
