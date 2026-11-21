import type { ConversationRepository, MessageRepository } from '../conversations/contracts';
import type { MemorySourceVerifier } from './memoryService';

/** Proves referenced data belongs to the requesting tenant/customer.
 * Actual identity verification of an inbound channel is an independent channel security gate.
 */
export class ConversationMemorySourceVerifier implements MemorySourceVerifier {
  constructor(private readonly conversations:ConversationRepository,private readonly messages:MessageRepository){}
  async verifyExplicitConsent(tenantId:string,customerId:string,sourceRef:string):Promise<boolean>{
    const message=await this.resolveMessage(tenantId,customerId,sourceRef);
    return !!message && /^AUTORIZO (?:A )?MEM[ÓO]RIA COMERCIAL\.?$/i.test(message.trim());
  }
  async verifyCustomerEvidence(tenantId:string,customerId:string,sourceRef:string):Promise<boolean>{
    return (await this.resolveMessage(tenantId,customerId,sourceRef))!==null;
  }
  private async resolveMessage(tenantId:string,customerId:string,sourceRef:string):Promise<string|null>{
    const match=/^conversation:([a-zA-Z0-9_-]{1,128}):([a-zA-Z0-9_-]{1,128})$/.exec(sourceRef);
    if(!match)return null;
    const conversation=await this.conversations.findById(tenantId,match[1]);
    if(!conversation||conversation.customerId!==customerId)return null;
    const messages=await this.messages.listByConversation(tenantId,conversation.id);
    const msg=messages.find(m=>m.id===match[2]&&m.customerId===customerId&&
      m.senderType==='CUSTOMER'&&m.direction==='INBOUND'&&m.type==='TEXT');
    if(!msg?.text)return null;
    return msg.tenantId===tenantId?msg.text:null;
  }
}
