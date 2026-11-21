import type { ConversationRepository,MessageRepository } from '../conversations/contracts';
import type { OrderConfirmationEvidence } from './model';

/**
 * T03 verifies a persisted, customer-authored inbound confirmation for THIS
 * exact draft and total in cents. Sender authentication at channel ingress is
 * a separate T08 requirement; generic chat messages never approve payment.
 */
export class ConversationOrderConfirmationVerifier implements OrderConfirmationEvidence {
  constructor(private readonly conversations:ConversationRepository,
    private readonly messages:MessageRepository){}
  async verify(tenantId:string,customerId:string,reference:string,orderId:string,
    totalMinor:number):Promise<boolean>{
    const match=/^conversation:([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128})$/.exec(reference);
    if(!match)return false;
    const conv=await this.conversations.findById(tenantId,match[1]);
    if(!conv||conv.customerId!==customerId)return false;
    const history=await this.messages.listByConversation(tenantId,conv.id);
    const msg=history.find(m=>m.id===match[2]&&m.tenantId===tenantId&&
      m.customerId===customerId&&m.conversationId===conv.id&&
      m.direction==='INBOUND'&&m.senderType==='CUSTOMER'&&m.type==='TEXT');
    if(!msg?.text)return false;
    // Requires full exact phrase containing order UUID + value. Never substring.
    return msg.text.trim().toUpperCase()===
      ('CONFIRMO PEDIDO '+orderId+' TOTAL '+totalMinor+' CENTAVOS').toUpperCase();
  }
}
