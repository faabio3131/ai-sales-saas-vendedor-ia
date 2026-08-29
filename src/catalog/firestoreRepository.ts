import { getFirestore } from 'firebase-admin/firestore';
import { ensureFirebaseAdminApp } from '../infrastructure/firebaseAdmin';
import { CatalogRepository } from './contracts';
import { CatalogItem } from './model';

function db() {
  return getFirestore(ensureFirebaseAdminApp());
}

function toFirestoreCatalogDocument(item: CatalogItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  );
}

export class FirestoreCatalogRepository implements CatalogRepository {
  async listByTenant(tenantId: string): Promise<CatalogItem[]> {
    const snapshot = await db().collection('catalogItems').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as CatalogItem);
  }

  async findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    const doc = await db().collection('catalogItems').doc(id).get();
    if (!doc.exists) return null;
    const item = doc.data() as CatalogItem;
    return item.tenantId === tenantId ? item : null;
  }

  async create(item: CatalogItem): Promise<CatalogItem> {
    await db().collection('catalogItems').doc(item.id).create(toFirestoreCatalogDocument(item));
    return item;
  }

  async update(item: CatalogItem): Promise<CatalogItem> {
    await db().collection('catalogItems').doc(item.id).set(toFirestoreCatalogDocument(item), { merge: false });
    return item;
  }
}
