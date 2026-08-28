import { describe, expect, it } from 'vitest';
import { CustomerRepository } from '../src/customers/contracts';
import { Customer, ExternalIdentity } from '../src/customers/model';
import { ConversationRepository, MessageRepository } from '../src/conversations/contracts';
import { Conversation, Message } from '../src/conversations/model';
import { ConversationService } from '../src/conversations/service';
import { TenantContext } from '../src/types/contracts';

class MemoryCustomerRepository implements CustomerRepository {
  constructor(private readonly customers: Customer[]) {}
  listByTenant(tenantId: string): Promise<Customer[]> { return Promise.resolve(this.customers.filter((c) => c.tenantId === tenantId)); }
  findById(tenantId: string, id: string): Promise<Customer | null> { return Promise.resolve(this.customers.find((c) => c.tenantId === tenantId && c.id === id) ?? null); }
  findByExternalIdentity(_tenantId: string, _identity: ExternalIdentity): Promise<Customer | null> { return Promise.resolve(null); }
  create(customer: Customer): Promise<Customer> { this.customers.push(customer); return Promise.resolve(customer); }
  update(customer: Customer): Promise<Customer> { return Promise.resolve(customer); }
}

class MemoryConversationRepository implements ConversationRepository {
  readonly items = new Map<string, Conversation>();
  listByTenant(tenantId: string): Promise<Conversation[]> { return Promise.resolve([...this.items.values()].filter((x) => x.tenantId === tenantId)); }
  findById(tenantId: string, id: string): Promise<Conversation | null> { const x = this.items.get(id); return Promise.resolve(x?.tenantId === tenantId ? x : null); }
  findByExternalConversationId(tenantId: string, channel: string, externalConversationId: string): Promise<Conversation | null> {
    return Promise.resolve([...this.items.values()].find((x) => x.tenantId === tenantId && x.channel === channel && x.externalConversationId === externalConversationId) ?? null);
  }
  create(conversation: Conversation): Promise<Conversation> { this.items.set(conversation.id, conversation); return Promise.resolve(conversation); }
  update(conversation: Conversation): Promise<Conversation> { this.items.set(conversation.id, conversation); return Promise.resolve(conversation); }
}

class MemoryMessageRepository implements MessageRepository {
  readonly items: Message[] = [];
  listByConversation(tenantId: string, conversationId: string): Promise<Message[]> {
    return Promise.resolve(this.items.filter((x) => x.tenantId === tenantId && x.conversationId === conversationId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)));
  }
  findByExternalMessageId(tenantId: string, externalMessageId: string): Promise<Message | null> {
    return Promise.resolve(this.items.find((x) => x.tenantId === tenantId && x.externalMessageId === externalMessageId) ?? null);
  }
  create(message: Message): Promise<Message> { this.items.push(message); return Promise.resolve(message); }
}

function context(tenantId: string): TenantContext {
  return { tenantId, userId: `user-${tenantId}`, role: 'OWNER', requestId: `req-${tenantId}` };
}

function customer(id: string, tenantId: string): Customer {
  const now = new Date().toISOString();
  return { id, tenantId, name: id, externalIdentities: [], status: 'ACTIVE', createdAt: now, updatedAt: now };
}

function setup() {
  const conversations = new MemoryConversationRepository();
  const messages = new MemoryMessageRepository();
  const customers = new MemoryCustomerRepository([customer('cust-a', 'tenant-a'), customer('cust-b', 'tenant-b')]);
  return { conversations, messages, service: new ConversationService(conversations, messages, customers) };
}

describe('BLK-060: Conversations', () => {
  it('creates conversations only for a customer inside the current tenant', async () => {
    const { service } = setup();
    const created = await service.create(context('tenant-a'), { customerId: 'cust-a', channel: 'WEB' });
    expect(created.tenantId).toBe('tenant-a');
    await expect(service.create(context('tenant-a'), { customerId: 'cust-b', channel: 'WEB' })).rejects.toMatchObject({ code: 'CUSTOMER_NOT_FOUND' });
  });

  it('does not disclose conversation or message history across tenants', async () => {
    const { service } = setup();
    const created = await service.create(context('tenant-a'), { customerId: 'cust-a', channel: 'WEB' });
    await service.addMessage(context('tenant-a'), created.id, { direction: 'INBOUND', senderType: 'CUSTOMER', text: 'Olá' });
    await expect(service.get(context('tenant-b'), created.id)).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    await expect(service.listMessages(context('tenant-b'), created.id)).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it('stores reliable ordered history and updates lastMessageAt', async () => {
    const { service } = setup();
    const created = await service.create(context('tenant-a'), { customerId: 'cust-a', channel: 'WEB' });
    await service.addMessage(context('tenant-a'), created.id, { direction: 'OUTBOUND', senderType: 'HUMAN', text: 'Segundo', occurredAt: '2026-08-28T22:00:02Z' });
    await service.addMessage(context('tenant-a'), created.id, { direction: 'INBOUND', senderType: 'CUSTOMER', text: 'Primeiro', occurredAt: '2026-08-28T22:00:01Z' });
    const history = await service.listMessages(context('tenant-a'), created.id);
    expect(history.map((m) => m.text)).toEqual(['Primeiro', 'Segundo']);
    expect((await service.get(context('tenant-a'), created.id)).lastMessageAt).toBe('2026-08-28T22:00:02.000Z');
  });

  it('deduplicates provider messages by externalMessageId inside the tenant', async () => {
    const { service, messages } = setup();
    const created = await service.create(context('tenant-a'), { customerId: 'cust-a', channel: 'WHATSAPP', externalConversationId: 'chat-1' });
    const first = await service.addMessage(context('tenant-a'), created.id, { direction: 'INBOUND', senderType: 'CUSTOMER', text: 'Oi', externalMessageId: 'wamid-1' });
    const second = await service.addMessage(context('tenant-a'), created.id, { direction: 'INBOUND', senderType: 'CUSTOMER', text: 'Duplicado', externalMessageId: 'wamid-1' });
    expect(second.id).toBe(first.id);
    expect(messages.items).toHaveLength(1);
  });

  it('supports structural AI to human handoff without deleting history', async () => {
    const { service } = setup();
    const created = await service.create(context('tenant-a'), { customerId: 'cust-a', channel: 'WEB', handlingMode: 'AI' });
    await service.addMessage(context('tenant-a'), created.id, { direction: 'OUTBOUND', senderType: 'AI', text: 'Posso ajudar?' });
    const handoff = await service.update(context('tenant-a'), created.id, { handlingMode: 'HANDOFF' });
    const human = await service.update(context('tenant-a'), created.id, { handlingMode: 'HUMAN' });
    expect(handoff.handlingMode).toBe('HANDOFF');
    expect(human.handlingMode).toBe('HUMAN');
    expect(await service.listMessages(context('tenant-a'), created.id)).toHaveLength(1);
  });

  it('rejects empty or oversized message content', async () => {
    const { service } = setup();
    const created = await service.create(context('tenant-a'), { customerId: 'cust-a', channel: 'WEB' });
    await expect(service.addMessage(context('tenant-a'), created.id, { direction: 'INBOUND', senderType: 'CUSTOMER' })).rejects.toMatchObject({ code: 'MESSAGE_CONTENT_REQUIRED' });
    await expect(service.addMessage(context('tenant-a'), created.id, { direction: 'INBOUND', senderType: 'CUSTOMER', text: 'x'.repeat(10001) })).rejects.toMatchObject({ code: 'MESSAGE_TEXT_TOO_LONG' });
  });
});
