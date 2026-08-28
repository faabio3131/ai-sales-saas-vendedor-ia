import { Conversation, Message } from './model';

export interface ConversationRepository {
  listByTenant(tenantId: string): Promise<Conversation[]>;
  findById(tenantId: string, id: string): Promise<Conversation | null>;
  findByExternalConversationId(tenantId: string, channel: string, externalConversationId: string): Promise<Conversation | null>;
  create(conversation: Conversation): Promise<Conversation>;
  update(conversation: Conversation): Promise<Conversation>;
}

export interface MessageRepository {
  listByConversation(tenantId: string, conversationId: string): Promise<Message[]>;
  findByExternalMessageId(tenantId: string, externalMessageId: string): Promise<Message | null>;
  create(message: Message): Promise<Message>;
}
