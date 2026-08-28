import { Result } from '../types/contracts';

export type ChannelName = 'WHATSAPP' | 'WEB' | 'OTHER';
export type NormalizedMessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'OTHER';

export interface OutboundChannelMessage {
  tenantId: string;
  channel: ChannelName;
  recipient: string;
  type: NormalizedMessageType;
  text?: string;
  mediaRef?: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelSendResult {
  channel: ChannelName;
  externalMessageId: string;
  acceptedAt: string;
}

export interface NormalizedInboundMessage {
  tenantId: string;
  channel: ChannelName;
  externalAccountRef?: string;
  externalConversationId?: string;
  externalMessageId: string;
  sender: string;
  type: NormalizedMessageType;
  text?: string;
  mediaRef?: string;
  occurredAt: string;
  rawEventId?: string;
}

export interface WebhookEnvelope {
  tenantId: string;
  headers: Record<string, string | undefined>;
  rawBody: string;
  payload: unknown;
}

export interface ChannelInterface {
  readonly id: ChannelName;
  sendMessage(message: OutboundChannelMessage): Promise<Result<ChannelSendResult>>;
  validateWebhook(input: WebhookEnvelope): Promise<Result<boolean>>;
  normalizeInbound(input: WebhookEnvelope): Promise<Result<NormalizedInboundMessage[]>>;
}
