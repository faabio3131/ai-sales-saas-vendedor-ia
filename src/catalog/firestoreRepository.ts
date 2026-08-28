import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CatalogRepository } from './contracts';
import { CatalogItem } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
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
    await db().collection('catalogItems').doc(item.id).create(item);
    return item;
  }

  async update(item: CatalogItem): Promise<CatalogItem> {
    await db().collection('catalogItems').doc(item.id).set(item, { merge: false });
    return item;
  }
}
