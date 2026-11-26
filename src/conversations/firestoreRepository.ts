import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ConversationRepository, MessageRepository } from './contracts';
import { Conversation, Message } from './model';
import { ApplicationError } from '../infrastructure/errors';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreConversationRepository implements ConversationRepository {
  async listByTenant(tenantId: string): Promise<Conversation[]> {
    const snapshot = await db().collection('conversations').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as Conversation);
  }

  async findById(tenantId: string, id: string): Promise<Conversation | null> {
    const doc = await db().collection('conversations').doc(id).get();
    if (!doc.exists) return null;
    const conversation = doc.data() as Conversation;
    return conversation.tenantId === tenantId ? conversation : null;
  }

  async findByExternalConversationId(tenantId: string, channel: string, externalConversationId: string): Promise<Conversation | null> {
    const snapshot = await db().collection('conversations')
      .where('tenantId', '==', tenantId)
      .where('channel', '==', channel)
      .where('externalConversationId', '==', externalConversationId)
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0].data() as Conversation;
  }

  async create(conversation: Conversation): Promise<Conversation> {
    await db().collection('conversations').doc(conversation.id).create(conversation);
    return conversation;
  }

  async update(conversation: Conversation): Promise<Conversation> {
    const database=db(),ref=database.collection('conversations').doc(conversation.id);
    return database.runTransaction(async tx=>{
      const current=(await tx.get(ref)).data() as Conversation|undefined;
      if(!current||current.tenantId!==conversation.tenantId||current.id!==conversation.id||
       current.customerId!==conversation.customerId||current.channel!==conversation.channel||
       current.externalConversationId!==conversation.externalConversationId)
        throw new ApplicationError({category:'CONFLICT',code:'CONVERSATION_SCOPE_CONFLICT',message:'Conversation changed concurrently.'});
      // The inbound transaction owns this projection. A stale general UI update
      // cannot roll it back or replace it with an outbound timestamp.
      const next={...conversation,lastMessageAt:current.lastMessageAt>conversation.lastMessageAt?current.lastMessageAt:conversation.lastMessageAt};
      if(current.lastInboundAt!==undefined)next.lastInboundAt=current.lastInboundAt;else delete next.lastInboundAt;
      if(current.lastInboundMessageId!==undefined)next.lastInboundMessageId=current.lastInboundMessageId;else delete next.lastInboundMessageId;
      tx.set(ref,next,{merge:false});return next;
    });
  }
}

export class FirestoreMessageRepository implements MessageRepository {
  async listByConversation(tenantId: string, conversationId: string): Promise<Message[]> {
    const snapshot = await db().collection('messages')
      .where('tenantId', '==', tenantId)
      .where('conversationId', '==', conversationId)
      .orderBy('occurredAt', 'asc')
      .get();
    return snapshot.docs.map((doc) => doc.data() as Message);
  }

  async findByExternalMessageId(tenantId: string, externalMessageId: string): Promise<Message | null> {
    const snapshot = await db().collection('messages')
      .where('tenantId', '==', tenantId)
      .where('externalMessageId', '==', externalMessageId)
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0].data() as Message;
  }

  async create(message: Message): Promise<Message> {
    await db().collection('messages').doc(message.id).create(message);
    return message;
  }
}
