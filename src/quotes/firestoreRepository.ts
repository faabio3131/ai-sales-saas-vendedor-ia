import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { QuoteItemRepository, QuoteRepository } from './contracts';
import { Quote, QuoteItem } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreQuoteRepository implements QuoteRepository {
  async listByTenant(tenantId: string): Promise<Quote[]> {
    const snapshot = await db().collection('quotes').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as Quote).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findById(tenantId: string, id: string): Promise<Quote | null> {
    const doc = await db().collection('quotes').doc(id).get();
    if (!doc.exists) return null;
    const quote = doc.data() as Quote;
    return quote.tenantId === tenantId ? quote : null;
  }

  async create(quote: Quote): Promise<Quote> {
    await db().collection('quotes').doc(quote.id).create(quote);
    return quote;
  }

  async update(quote: Quote): Promise<Quote> {
    await db().collection('quotes').doc(quote.id).set(quote, { merge: false });
    return quote;
  }
}

export class FirestoreQuoteItemRepository implements QuoteItemRepository {
  async listByQuote(tenantId: string, quoteId: string): Promise<QuoteItem[]> {
    const snapshot = await db().collection('quoteItems')
      .where('tenantId', '==', tenantId)
      .where('quoteId', '==', quoteId)
      .get();
    return snapshot.docs.map((doc) => doc.data() as QuoteItem);
  }

  async createMany(items: QuoteItem[]): Promise<QuoteItem[]> {
    const batch = db().batch();
    for (const item of items) {
      batch.create(db().collection('quoteItems').doc(item.id), item);
    }
    await batch.commit();
    return items;
  }
}
