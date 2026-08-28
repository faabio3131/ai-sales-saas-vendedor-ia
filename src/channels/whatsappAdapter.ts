import { createErrorResult } from '../infrastructure/errors';
import { Result } from '../types/contracts';
import { ChannelInterface, ChannelSendResult, NormalizedInboundMessage, OutboundChannelMessage, WebhookEnvelope } from './contracts';

export interface WhatsAppTransport {
  send(input: { recipient: string; type: string; text?: string; mediaRef?: string; idempotencyKey: string }): Promise<{ externalMessageId: string }>;
}

export interface WhatsAppWebhookVerifier {
  verify(input: { rawBody: string; signature?: string }): Promise<boolean>;
}

function obj(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function arr(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function str(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }

export class WhatsAppAdapter implements ChannelInterface {
  readonly id = 'WHATSAPP' as const;

  constructor(private readonly transport: WhatsAppTransport, private readonly verifier: WhatsAppWebhookVerifier) {}

  async sendMessage(message: OutboundChannelMessage): Promise<Result<ChannelSendResult>> {
    try {
      const sent = await this.transport.send({ recipient: message.recipient, type: message.type, text: message.text, mediaRef: message.mediaRef, idempotencyKey: message.idempotencyKey });
      if (!sent.externalMessageId?.trim()) return createErrorResult('PROVIDER','WHATSAPP_RESPONSE_INVALID','Channel provider returned an invalid response.',true);
      return { ok: true, data: { channel: this.id, externalMessageId: sent.externalMessageId.trim(), acceptedAt: new Date().toISOString() } };
    } catch {
      return createErrorResult('PROVIDER','WHATSAPP_SEND_FAILED','Channel request failed.',true);
    }
  }

  async validateWebhook(input: WebhookEnvelope): Promise<Result<boolean>> {
    try {
      const signature = input.headers['x-hub-signature-256'] ?? input.headers['X-Hub-Signature-256'];
      return { ok: true, data: await this.verifier.verify({ rawBody: input.rawBody, signature }) };
    } catch {
      return createErrorResult('PROVIDER','WHATSAPP_WEBHOOK_VALIDATION_FAILED','Webhook validation failed.',false);
    }
  }

  async normalizeInbound(input: WebhookEnvelope): Promise<Result<NormalizedInboundMessage[]>> {
    const root = obj(input.payload);
    if (!root) return createErrorResult('VALIDATION','WHATSAPP_PAYLOAD_INVALID','Webhook payload is invalid.',false);
    const normalized: NormalizedInboundMessage[] = [];
    for (const entryValue of arr(root.entry)) {
      const entry = obj(entryValue); if (!entry) continue;
      for (const changeValue of arr(entry.changes)) {
        const change = obj(changeValue); const value = obj(change?.value); if (!value) continue;
        const metadata = obj(value.metadata);
        const accountRef = str(metadata?.phone_number_id) ?? str(metadata?.display_phone_number);
        for (const messageValue of arr(value.messages)) {
          const message = obj(messageValue); if (!message) continue;
          const externalMessageId = str(message.id); const sender = str(message.from);
          if (!externalMessageId || !sender) continue;
          const typeRaw = (str(message.type) ?? 'other').toUpperCase();
          const type = ['TEXT','IMAGE','AUDIO','VIDEO','DOCUMENT'].includes(typeRaw) ? typeRaw as NormalizedInboundMessage['type'] : 'OTHER';
          const text = str(obj(message.text)?.body);
          const media = obj(message[typeRaw.toLowerCase()]);
          const timestampSeconds = Number(str(message.timestamp));
          const occurredAt = Number.isFinite(timestampSeconds) && timestampSeconds > 0 ? new Date(timestampSeconds * 1000).toISOString() : new Date().toISOString();
          normalized.push({
            tenantId: input.tenantId,
            channel: this.id,
            externalAccountRef: accountRef,
            externalConversationId: sender,
            externalMessageId,
            sender,
            type,
            text,
            mediaRef: str(media?.id),
            occurredAt,
            rawEventId: externalMessageId,
          });
        }
      }
    }
    return { ok: true, data: normalized };
  }
}
