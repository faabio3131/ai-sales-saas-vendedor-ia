import { describe, expect, it, vi } from 'vitest';
import { ChannelService } from '../src/channels/service';
import { WhatsAppAdapter } from '../src/channels/whatsappAdapter';

const transport = () => ({ send: vi.fn(async () => ({ externalMessageId: 'wamid.123' })) });
const verifier = (valid = true) => ({ verify: vi.fn(async () => valid) });

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    headers: { 'x-hub-signature-256': 'sha256=test' },
    rawBody: '{"test":true}',
    payload: {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'phone-1' },
        messages: [{ id: 'wamid.in.1', from: '5511999999999', timestamp: '1787950000', type: 'text', text: { body: 'Quero um orçamento' } }],
      } }] }],
    },
    ...overrides,
  };
}

describe('BLK-120 Channels / WhatsApp', () => {
  it('sends through the provider-neutral service with idempotency', async () => {
    const t = transport(); const adapter = new WhatsAppAdapter(t, verifier());
    const result = await new ChannelService([adapter]).send({ tenantId:'tenant-a', channel:'WHATSAPP', recipient:'5511999999999', type:'TEXT', text:'Olá', idempotencyKey:'send-1' });
    expect(result).toMatchObject({ ok:true, data:{ channel:'WHATSAPP', externalMessageId:'wamid.123' } });
    expect(t.send).toHaveBeenCalledWith(expect.objectContaining({ recipient:'5511999999999', idempotencyKey:'send-1' }));
  });

  it('requires tenant and idempotency before any outbound provider call', async () => {
    const t = transport(); const service = new ChannelService([new WhatsAppAdapter(t, verifier())]);
    const noTenant = await service.send({ tenantId:'', channel:'WHATSAPP', recipient:'55', type:'TEXT', text:'Oi', idempotencyKey:'k' });
    const noKey = await service.send({ tenantId:'tenant-a', channel:'WHATSAPP', recipient:'55', type:'TEXT', text:'Oi', idempotencyKey:'' });
    expect(noTenant.error?.code).toBe('CHANNEL_TENANT_REQUIRED');
    expect(noKey.error?.code).toBe('CHANNEL_IDEMPOTENCY_REQUIRED');
    expect(t.send).not.toHaveBeenCalled();
  });

  it('validates webhook before normalization', async () => {
    const v = verifier(false); const adapter = new WhatsAppAdapter(transport(), v);
    const result = await new ChannelService([adapter]).receive('WHATSAPP', envelope());
    expect(result.ok).toBe(false); expect(result.error?.code).toBe('CHANNEL_WEBHOOK_INVALID');
    expect(v.verify).toHaveBeenCalledWith({ rawBody:'{"test":true}', signature:'sha256=test' });
  });

  it('normalizes WhatsApp Cloud-style inbound payload without exposing raw provider payload', async () => {
    const result = await new ChannelService([new WhatsAppAdapter(transport(), verifier(true))]).receive('WHATSAPP', envelope());
    expect(result.ok).toBe(true);
    expect(result.data?.[0]).toMatchObject({ tenantId:'tenant-a', channel:'WHATSAPP', externalAccountRef:'phone-1', externalConversationId:'5511999999999', externalMessageId:'wamid.in.1', sender:'5511999999999', type:'TEXT', text:'Quero um orçamento', rawEventId:'wamid.in.1' });
    expect(result.data?.[0]).not.toHaveProperty('payload');
  });

  it('normalizes media references and unknown message types safely', async () => {
    const payload = { entry:[{ changes:[{ value:{ messages:[
      { id:'media-1', from:'55', timestamp:'1787950000', type:'image', image:{ id:'media-ref' } },
      { id:'other-1', from:'55', timestamp:'1787950000', type:'sticker', sticker:{ id:'sticker-ref' } },
    ] } }] }] };
    const result = await new ChannelService([new WhatsAppAdapter(transport(), verifier())]).receive('WHATSAPP', envelope({ payload }));
    expect(result.data?.[0]).toMatchObject({ type:'IMAGE', mediaRef:'media-ref' });
    expect(result.data?.[1]).toMatchObject({ type:'OTHER' });
  });

  it('sanitizes provider send failures', async () => {
    const bad = { send: vi.fn(async () => { throw new Error('secret access token detail'); }) };
    const result = await new ChannelService([new WhatsAppAdapter(bad, verifier())]).send({ tenantId:'tenant-a', channel:'WHATSAPP', recipient:'55', type:'TEXT', text:'Oi', idempotencyKey:'x' });
    expect(result.error?.code).toBe('WHATSAPP_SEND_FAILED');
    expect(JSON.stringify(result)).not.toContain('secret access token detail');
  });

  it('rejects unavailable channels and invalid webhook payloads with normalized errors', async () => {
    const empty = new ChannelService([]);
    const missing = await empty.send({ tenantId:'tenant-a', channel:'OTHER', recipient:'55', type:'TEXT', text:'Oi', idempotencyKey:'x' });
    expect(missing.error?.code).toBe('CHANNEL_UNAVAILABLE');
    const service = new ChannelService([new WhatsAppAdapter(transport(), verifier())]);
    const invalid = await service.receive('WHATSAPP', envelope({ payload:'invalid' }));
    expect(invalid.error?.code).toBe('WHATSAPP_PAYLOAD_INVALID');
  });
});
