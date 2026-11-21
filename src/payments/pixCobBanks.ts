import type {ProviderPaymentRequest,ProviderPaymentResult} from './model';
import {PixOnlyProvider,ProviderTransport,obj,str,minor,money,reference,txid,fail} from './bankCommon';

export type PixCobBank='EFI'|'BANCO_INTER'|'BANCO_DO_BRASIL';
export interface PixCobSettings {
 tenantId:string; recipientId:string; pixKey:string; bank:PixCobBank;
 request:ProviderTransport; // authenticated, mTLS-capable, pinned-host transport
}
export class PixCobBankProvider extends PixOnlyProvider {
 readonly id:PixCobBank;
 readonly tenantId:string;
 readonly recipientId:string;
 constructor(private readonly cfg:PixCobSettings){
  super();this.id=cfg.bank;this.tenantId=cfg.tenantId;this.recipientId=cfg.recipientId;
  if(!cfg.tenantId||!cfg.recipientId||!cfg.pixKey)fail('BANK_CONFIG_INVALID');
 }
 private normalize(raw:unknown, fallbackId?:string):ProviderPaymentResult {
  const j=obj(raw);const id=str(j.txid)||fallbackId||'';
  if(!/^[a-f0-9]{26,35}$/i.test(id)) return fail('BANK_TXID_INVALID');
  const amount=minor(obj(j.valor).original);
  const status=str(j.status);
  if(!['ATIVA','CONCLUIDA','REMOVIDA_PELO_USUARIO_RECEBEDOR','REMOVIDA_PELO_PSP'].includes(status))return fail('BANK_STATUS_UNKNOWN');
  const paid=Array.isArray(j.pix)?j.pix:[];
  if(status==='CONCLUIDA'){
   // Only mark paid when the bank returns a matching settled Pix.
   const settled=paid.reduce((sum:number,v:unknown)=>sum+minor(obj(v).valor),0);
   if(settled!==amount) return fail('BANK_SETTLEMENT_MISMATCH');
  }
  const payerReference=str(j.solicitacaoPagador);
  if(!payerReference) return fail('BANK_REFERENCE_MISSING');
  const code=str(j.pixCopiaECola);
  return {provider:this.id,providerPaymentId:id,
   referenceId:payerReference,amountMinor:amount,
   status:status==='CONCLUIDA'?'CONFIRMED':status==='ATIVA'?'PENDING':'CANCELLED',
   ...(code?{pixCode:code}:{}),
  };
 }
 async createPix(input:ProviderPaymentRequest):Promise<ProviderPaymentResult> {
  if(input.tenantId!==this.tenantId)return fail('BANK_TENANT_MISMATCH');
  const id=txid(input);
  const payload={calendario:{expiracao:3600},valor:{original:money(input.amountMinor)},chave:this.cfg.pixKey,
   solicitacaoPagador:reference(input)};
  const bankResponse=await this.cfg.request('/v2/cob/'+id,'PUT',payload);
  const result=this.normalize(bankResponse,id);
  if(result.amountMinor!==input.amountMinor||result.referenceId!==reference(input))return fail('BANK_CHARGE_MISMATCH');
  // Some banks provide QR data separately; no invented Pix payload is ever returned.
  if(!result.pixCode){
   const charge=obj(bankResponse);
   const loc=charge.loc&&typeof charge.loc==='object'?obj(charge.loc):null;
   const locationId=loc?str(loc.id):'';
   if(locationId&&/^\d{1,20}$/.test(locationId)){
    const qr=await this.cfg.request('/v2/loc/'+locationId+'/qrcode','GET');
    const pixCode=str(qr.qrcode)||str(qr.pixCopiaECola);
    if(pixCode)result.pixCode=pixCode;
   }
  }
  if(!result.pixCode)return fail('BANK_PIX_CODE_UNAVAILABLE');
  return result;
 }
 async getPaymentStatus(providerPaymentId:string):Promise<ProviderPaymentResult>{
  if(!/^[a-f0-9]{26,35}$/i.test(providerPaymentId))return fail('BANK_TXID_INVALID');
  return this.normalize(await this.cfg.request('/v2/cob/'+providerPaymentId,'GET'),providerPaymentId);
 }
}
