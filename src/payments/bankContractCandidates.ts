import {createHash} from 'node:crypto';
/** Deterministic logical reference for bank Pix-Cob transactions. */
export function merchantPixCobReference(tenantId:string,quoteId:string):string {
 return tenantId+':'+quoteId;
}
export function merchantPixCobTxid(tenantId:string,key:string):string {
 return createHash('sha256').update(tenantId+'\x00'+key).digest('hex').slice(0,32);
}
/**
 * Santander Pix Recebimentos and Itaú Pix Recebimentos may expose Pix Cob compatible
 * payloads. Their actual URLs, OAuth/mTLS flows and webhook contracts remain
 * institution-specific. This module does not assume these contracts are identical.
 */
export const PIX_COB_CONTRACT_CANDIDATES=Object.freeze({
 SANTANDER:{standard:'BACEN_PIX_COB',status:'CONTRACT_PENDING'},
 ITAU:{standard:'BACEN_PIX_COB',status:'CONTRACT_PENDING'},
});
