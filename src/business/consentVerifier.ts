import type { ConversationRepository, MessageRepository } from '../conversations/contracts';
import type { MemorySourceVerifier } from './memoryService';

/** Proves referenced data belongs to the requesting tenant/customer.
 * Actual identity verification of an inbound channel is an independent channel security gate.
 */
export class ConversationMemorySourceVerifier implements MemorySourceVerifier {
  constructor(private readonly conversations:ConversationRepository,private readonly messages:MessageRepository){}
  async verifyCustomerEvidence(tenantId:string,customerId:string,sourceRef:string):Promise<boolean>{
    const match=/^conversation:([a-zA-Z0-9_-]{1,128}):([a-zA-Z0-9_-]{1,128})$/.exec(sourceRef);
    if(!match)return false;
    const conversation=await this.conversations.findById(tenantId,match[1]);
    if(!conversation||conversation.customerId!==customerId)return false;
    const messages=await this.messages.listByConversation(tenantId,conversation.id);
    const msg=messages.find(m=>m.id===match[2]&&m.customerId===customerId&&
      m.senderType==='CUSTOMER'&&m.direction==='INBOUND'&&m.type==='TEXT');
    if(!msg?.text)return false;
    return msg.tenantId===tenantId;
  }
}
