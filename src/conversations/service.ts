import { randomUUID } from 'crypto';
import { CustomerRepository } from '../customers/contracts';
import { ApplicationError } from '../infrastructure/errors';
import { TenantContext } from '../types/contracts';
import { ConversationRepository, MessageRepository } from './contracts';
import {
  Conversation,
  ConversationHandlingMode,
  CreateConversationInput,
  CreateMessageInput,
  Message,
  UpdateConversationInput,
} from './model';

function requireTenant(context: TenantContext): string {
  const tenantId = context.tenantId?.trim();
  if (!tenantId) {
    throw new ApplicationError({ category: 'FORBIDDEN', code: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required.' });
  }
  return tenantId;
}

function normalizeTimestamp(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'MESSAGE_OCCURRED_AT_INVALID', message: 'Message timestamp is invalid.' });
  }
  return date.toISOString();
}

function validateHandlingMode(mode: ConversationHandlingMode): ConversationHandlingMode {
  if (!['AI', 'HUMAN', 'HANDOFF'].includes(mode)) {
    throw new ApplicationError({ category: 'VALIDATION', code: 'CONVERSATION_HANDLING_MODE_INVALID', message: 'Conversation handling mode is invalid.' });
  }
  return mode;
}

export class ConversationService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly customers: CustomerRepository,
  ) {}

  list(context: TenantContext): Promise<Conversation[]> {
    return this.conversations.listByTenant(requireTenant(context));
  }

  async get(context: TenantContext, id: string): Promise<Conversation> {
    const conversation = await this.conversations.findById(requireTenant(context), id.trim());
    if (!conversation) {
      throw new ApplicationError({ category: 'NOT_FOUND', code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    }
    return conversation;
  }

  async create(context: TenantContext, input: CreateConversationInput): Promise<Conversation> {
    const tenantId = requireTenant(context);
    const customerId = input.customerId?.trim();
    if (!customerId || !(await this.customers.findById(tenantId, customerId))) {
      throw new ApplicationError({ category: 'NOT_FOUND', code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' });
    }
    if (!['WEB', 'WHATSAPP', 'OTHER'].includes(input.channel)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'CONVERSATION_CHANNEL_INVALID', message: 'Conversation channel is invalid.' });
    }
    const externalConversationId = input.externalConversationId?.trim() || undefined;
    if (externalConversationId) {
      const existing = await this.conversations.findByExternalConversationId(tenantId, input.channel, externalConversationId);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    return this.conversations.create({
      id: randomUUID(),
      tenantId,
      customerId,
      channel: input.channel,
      externalConversationId,
      status: 'OPEN',
      handlingMode: validateHandlingMode(input.handlingMode ?? 'AI'),
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  async update(context: TenantContext, id: string, input: UpdateConversationInput): Promise<Conversation> {
    const current = await this.get(context, id);
    const status = input.status ?? current.status;
    if (!['OPEN', 'CLOSED'].includes(status)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'CONVERSATION_STATUS_INVALID', message: 'Conversation status is invalid.' });
    }
    const handlingMode = input.handlingMode === undefined ? current.handlingMode : validateHandlingMode(input.handlingMode);
    return this.conversations.update({ ...current, status, handlingMode, updatedAt: new Date().toISOString() });
  }

  async listMessages(context: TenantContext, conversationId: string): Promise<Message[]> {
    const conversation = await this.get(context, conversationId);
    return this.messages.listByConversation(conversation.tenantId, conversation.id);
  }

  async addMessage(context: TenantContext, conversationId: string, input: CreateMessageInput): Promise<Message> {
    const conversation = await this.get(context, conversationId);
    if (!['INBOUND', 'OUTBOUND'].includes(input.direction)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'MESSAGE_DIRECTION_INVALID', message: 'Message direction is invalid.' });
    }
    if (!['CUSTOMER', 'AI', 'HUMAN', 'SYSTEM'].includes(input.senderType)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'MESSAGE_SENDER_INVALID', message: 'Message sender is invalid.' });
    }
    const type = input.type ?? 'TEXT';
    if (!['TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'OTHER'].includes(type)) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'MESSAGE_TYPE_INVALID', message: 'Message type is invalid.' });
    }
    const text = input.text?.trim() || undefined;
    const mediaRef = input.mediaRef?.trim() || undefined;
    if (!text && !mediaRef) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'MESSAGE_CONTENT_REQUIRED', message: 'Message content is required.' });
    }
    if (text && text.length > 10000) {
      throw new ApplicationError({ category: 'VALIDATION', code: 'MESSAGE_TEXT_TOO_LONG', message: 'Message text is too long.' });
    }
    const externalMessageId = input.externalMessageId?.trim() || undefined;
    if (externalMessageId) {
      const existing = await this.messages.findByExternalMessageId(conversation.tenantId, externalMessageId);
      if (existing) return existing;
    }
    const occurredAt = normalizeTimestamp(input.occurredAt);
    const message = await this.messages.create({
      id: randomUUID(),
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      direction: input.direction,
      senderType: input.senderType,
      type,
      text,
      mediaRef,
      externalMessageId,
      occurredAt,
      idempotencyKey: input.idempotencyKey?.trim() || undefined,
    });
    await this.conversations.update({
      ...conversation,
      lastMessageAt: occurredAt > conversation.lastMessageAt ? occurredAt : conversation.lastMessageAt,
      updatedAt: new Date().toISOString(),
    });
    return message;
  }
}
