import {getFirestore} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {Order} from '../orders/model';
import type {ConversationRepository,MessageRepository} from '../conversations/contracts';
import type {CustomerRepository} from '../customers/contracts';
import type {VerifiedCustomerChannelRepository} from '../fulfillment/trustedChannelIdentity';

/** This immutable attestation must be inserted ONLY by the HMAC/signature-verified
 * provider ingestion path (T08). The ordinary messages API is user-writable,
 * and is NEVER sufficient evidence for autonomous customer consent/confirmation. */
export interface TrustedInboundReceipt {
 tenantId:string;unitId:string;customerId:string;conversationId:string;
 messageId:string;externalMessageId:string;recipient:string;
 provenance:'SIGNED_PROVIDER_WEBHOOK';verifiedAt:string;proofRef:string;
}
function key(...a:string[]):string{
 return createHash('sha256').update(JSON.stringify(a)).digest('hex');
}
export interface TrustedInboundRepository {
 get(t:string,u:string,conversationId:string,messageId:string):Promise<TrustedInboundReceipt|null>;
}
export class FirestoreTrustedInboundRepository implements TrustedInboundRepository {
 async get(t:string,u:string,c:string,m:string){
  const d=await getFirestore(ensureFirebaseAdminApp()).collection('governanceTrustedInboundMessages')
   .doc(key(t,u,c,m)).get();const r=d.data() as TrustedInboundReceipt|undefined;
  return r?.tenantId===t&&r.unitId===u&&r.conversationId===c&&r.messageId===m&&
    r.provenance==='SIGNED_PROVIDER_WEBHOOK'&&!!r.proofRef&&
    Number.isFinite(Date.parse(r.verifiedAt))?r:null;
 }
}
/** Strong evidence wrapper for autonomous WhatsApp checkout.
 * The T03 verifier independently checks the exact confirmation phrase,
 * exact order/total, and customer/tenant. This adds verified channel origin. */
export class AutonomousInboundTrust {
 constructor(private readonly conversations:ConversationRepository,
  private readonly messages:MessageRepository,private readonly customers:Pick<CustomerRepository,'findById'>,
  private readonly identities:VerifiedCustomerChannelRepository,
  private readonly verified:TrustedInboundRepository){}
 async verify(order:Pick<Order,'tenantId'|'unitId'|'customerId'|'id'>,ref:string){
  const match=/^conversation:([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128})$/.exec(ref);
  if(!match)return false;
  const [conv,history,customer,identity,receipt]=await Promise.all([
    this.conversations.findById(order.tenantId,match[1]),
    this.messages.listByConversation(order.tenantId,match[1]),
    this.customers.findById(order.tenantId,order.customerId),
    this.identities.get(order.tenantId,order.customerId,'WHATSAPP'),
    this.verified.get(order.tenantId,order.unitId,match[1],match[2]),
  ]);
  const msg=history.find(m=>m.id===match[2]);
  return !!(conv&&conv.tenantId===order.tenantId&&conv.customerId===order.customerId&&
    conv.channel==='WHATSAPP'&&msg&&msg.tenantId===order.tenantId&&
    msg.customerId===order.customerId&&msg.conversationId===conv.id&&
    msg.direction==='INBOUND'&&msg.senderType==='CUSTOMER'&&msg.type==='TEXT'&&
    msg.externalMessageId&&customer?.status==='ACTIVE'&&identity&&
    identity.recipient===customer.phone&&conv.externalConversationId===identity.recipient&&
    receipt&&receipt.customerId===order.customerId&&
    receipt.externalMessageId===msg.externalMessageId&&
    receipt.recipient===identity.recipient);
 }
}
