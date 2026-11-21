
import type {WebhookEnvelope} from '../channels/contracts';
import {ChannelService} from '../channels/service';
import type {ConversationRepository,MessageRepository} from '../conversations/contracts';
import type {CustomerRepository} from '../customers/contracts';
import type {OrderRepository} from '../orders/model';
import type {VerifiedCustomerChannelRepository} from '../fulfillment/trustedChannelIdentity';
import {FirestoreTrustedInboundRepository,type TrustedInboundReceipt} from './trust';
import type {ContactConsentRepository} from './repository';
import {classifyCommercialRisks} from './risk';
import {deny} from './validation';

/** Private server-side hook for a signature-verified provider envelope.
 * Not mounted as a public endpoint. T08 owns genuine WhatsApp webhook routing
 * (phone-number-id to tenant/unit) and external credential homologation.
 * The authenticated channel verifier must run before any trust record is written. */
export class VerifiedCommercialChannelIngress {
 constructor(private readonly channel:ChannelService,
  private readonly conversations:ConversationRepository,
  private readonly messages:MessageRepository,
  private readonly customers:Pick<CustomerRepository,'findById'>,
  private readonly identities:VerifiedCustomerChannelRepository,
  private readonly orders:OrderRepository,
  private readonly proofs:FirestoreTrustedInboundRepository,
  private readonly contacts:ContactConsentRepository){}
 async accept(tenantId:string,unitId:string,envelope:WebhookEnvelope,orderId?:string){
  if(!tenantId||!unitId||!envelope||envelope.tenantId!==tenantId)
   deny('AUTONOMY_CHANNEL_SCOPE_INVALID');
  const verified=await this.channel.receive('WHATSAPP',envelope);
  if(!verified.ok||!verified.data)deny('AUTONOMY_WEBHOOK_SIGNATURE_REQUIRED');
  const receipts:TrustedInboundReceipt[]=[];
  for(const event of verified.data){
   if(event.tenantId!==tenantId||event.channel!=='WHATSAPP'||event.type!=='TEXT'||
     !event.externalMessageId||!event.externalConversationId||!event.text||!event.sender||
     !Number.isFinite(Date.parse(event.occurredAt)))
    deny('AUTONOMY_WEBHOOK_MESSAGE_INVALID');
   const conversation=await this.conversations.findByExternalConversationId(
     tenantId,'WHATSAPP',event.externalConversationId);
   if(!conversation||conversation.tenantId!==tenantId||
     conversation.channel!=='WHATSAPP'||!conversation.customerId||
     conversation.externalConversationId!==event.sender)
    deny('AUTONOMY_WEBHOOK_CONVERSATION_UNVERIFIED');
   const [history,customer,identity]=await Promise.all([
    this.messages.listByConversation(tenantId,conversation.id),
    this.customers.findById(tenantId,conversation.customerId),
    this.identities.get(tenantId,conversation.customerId,'WHATSAPP'),
   ]);
   if(customer?.status!=='ACTIVE'||!identity||identity.tenantId!==tenantId||
      identity.customerId!==customer.id||identity.recipient!==customer.phone||
      identity.recipient!==event.sender||!identity.proofRef)
    deny('AUTONOMY_WEBHOOK_RECIPIENT_UNVERIFIED');
   const msg=history.find(m=>m.externalMessageId===event.externalMessageId&&
     m.conversationId===conversation.id&&m.customerId===conversation.customerId&&
     m.tenantId===tenantId&&m.direction==='INBOUND'&&
     m.senderType==='CUSTOMER'&&m.type==='TEXT'&&m.text===event.text);
   if(!msg)deny('AUTONOMY_WEBHOOK_MESSAGE_NOT_PERSISTED');
   let signals:string[]=[];
   if(orderId){
    const order=await this.orders.findById(tenantId,unitId,orderId);
    if(!order||order.customerId!==conversation.customerId)
     deny('AUTONOMY_WEBHOOK_ORDER_SCOPE_INVALID');
    // Scan the conversation history, not just the final "confirm" message.
    // A later clean message cannot erase a previous allergen/dispute alert.
    signals=[...new Set(history.filter(m=>m.tenantId===tenantId&&
      m.customerId===conversation.customerId&&m.direction==='INBOUND'&&
      m.senderType==='CUSTOMER'&&m.type==='TEXT'&&typeof m.text==='string')
      .flatMap(m=>classifyCommercialRisks(m.text!)))];
   }
   const receipt:TrustedInboundReceipt={
    tenantId,unitId,customerId:conversation.customerId,conversationId:conversation.id,
    messageId:msg.id,externalMessageId:event.externalMessageId,
    recipient:event.sender,provenance:'SIGNED_PROVIDER_WEBHOOK',
    proofRef:'provider-webhook:'+event.externalMessageId,
    verifiedAt:event.occurredAt,
   };
   await this.proofs.recordVerified(receipt,orderId,signals);
   receipts.push(receipt);
   const text=event.text.trim().toUpperCase();
   const preference=text==='PARAR'||text==='CANCELAR OFERTAS'?'OPT_OUT':
     text==='AUTORIZO RECEBER OFERTAS'?'OPT_IN':null;
   if(preference)await this.contacts.recordFromVerifiedWebhook({
    tenantId,unitId,customerId:conversation.customerId,channel:'WHATSAPP',
    preference,provenance:'SIGNED_PROVIDER_WEBHOOK',
    recipient:event.sender,providerEventId:event.externalMessageId,
    recordedAt:event.occurredAt,
   });
  }
  return receipts;
 }
}
