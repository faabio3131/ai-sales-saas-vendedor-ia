export type ConversationChannel = 'WEB' | 'WHATSAPP' | 'OTHER';
export type ConversationStatus = 'OPEN' | 'CLOSED';
export type ConversationHandlingMode = 'AI' | 'HUMAN' | 'HANDOFF';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageSenderType = 'CUSTOMER' | 'AI' | 'HUMAN' | 'SYSTEM';
export type MessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'OTHER';

export interface Conversation {
  id: string;
  tenantId: string;
  customerId: string;
  channel: ConversationChannel;
  externalConversationId?: string;
  status: ConversationStatus;
  handlingMode: ConversationHandlingMode;
  lastMessageAt: string;
  /** Server-owned inbound ordering projection; never supplied by UI updates. */
  lastInboundAt?: string;
  lastInboundMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  tenantId: string;
  conversationId: string;
  customerId: string;
  direction: MessageDirection;
  senderType: MessageSenderType;
  type: MessageType;
  text?: string;
  mediaRef?: string;
  externalMessageId?: string;
  occurredAt: string;
  idempotencyKey?: string;
}

export interface CreateConversationInput {
  customerId: string;
  channel: ConversationChannel;
  externalConversationId?: string;
  handlingMode?: ConversationHandlingMode;
}

export interface CreateMessageInput {
  direction: MessageDirection;
  senderType: MessageSenderType;
  type?: MessageType;
  text?: string;
  mediaRef?: string;
  externalMessageId?: string;
  occurredAt?: string;
  idempotencyKey?: string;
}

export interface UpdateConversationInput {
  status?: ConversationStatus;
  handlingMode?: ConversationHandlingMode;
}
