import { createErrorResult } from '../infrastructure/errors';
import { Result } from '../types/contracts';
import { ChannelInterface, ChannelName, ChannelSendResult, NormalizedInboundMessage, OutboundChannelMessage, WebhookEnvelope } from './contracts';

export class ChannelService {
  private readonly adapters = new Map<ChannelName, ChannelInterface>();

  constructor(adapters: ChannelInterface[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) throw new Error(`Duplicate channel adapter: ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
    }
  }

  supportedChannels(): ChannelName[] {
    return [...this.adapters.keys()];
  }

  async send(message: OutboundChannelMessage): Promise<Result<ChannelSendResult>> {
    if (!message.tenantId?.trim()) return createErrorResult('VALIDATION','CHANNEL_TENANT_REQUIRED','Tenant is required.',false);
    if (!message.recipient?.trim()) return createErrorResult('VALIDATION','CHANNEL_RECIPIENT_REQUIRED','Recipient is required.',false);
    if (!message.idempotencyKey?.trim()) return createErrorResult('VALIDATION','CHANNEL_IDEMPOTENCY_REQUIRED','Idempotency key is required.',false);
    if (!message.text?.trim() && !message.mediaRef?.trim()) return createErrorResult('VALIDATION','CHANNEL_CONTENT_REQUIRED','Message content is required.',false);
    const adapter = this.adapters.get(message.channel);
    if (!adapter) return createErrorResult('PROVIDER','CHANNEL_UNAVAILABLE','Channel is unavailable.',false);
    try { return await adapter.sendMessage({ ...message, tenantId: message.tenantId.trim(), recipient: message.recipient.trim(), idempotencyKey: message.idempotencyKey.trim() }); }
    catch { return createErrorResult('PROVIDER','CHANNEL_SEND_FAILED','Channel request failed.',true); }
  }

  async receive(channel: ChannelName, input: WebhookEnvelope): Promise<Result<NormalizedInboundMessage[]>> {
    if (!input.tenantId?.trim()) return createErrorResult('VALIDATION','CHANNEL_TENANT_REQUIRED','Tenant is required.',false);
    const adapter = this.adapters.get(channel);
    if (!adapter) return createErrorResult('PROVIDER','CHANNEL_UNAVAILABLE','Channel is unavailable.',false);
    try {
      const valid = await adapter.validateWebhook(input);
      if (!valid.ok) return valid as Result<NormalizedInboundMessage[]>;
      if (!valid.data) return createErrorResult('FORBIDDEN','CHANNEL_WEBHOOK_INVALID','Webhook validation failed.',false);
      return await adapter.normalizeInbound({ ...input, tenantId: input.tenantId.trim() });
    } catch {
      return createErrorResult('PROVIDER','CHANNEL_WEBHOOK_FAILED','Channel webhook processing failed.',true);
    }
  }
}
