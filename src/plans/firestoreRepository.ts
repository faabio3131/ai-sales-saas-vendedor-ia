import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SubscriptionRepository, UsageRepository } from './contracts';
import { Subscription, UsageCounter } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreSubscriptionRepository implements SubscriptionRepository {
  async findByTenant(tenantId: string): Promise<Subscription | null> {
    const doc = await db().collection('subscriptions').doc(tenantId).get();
    if (!doc.exists) return null;
    const value = doc.data() as Subscription;
    return value.tenantId === tenantId ? value : null;
  }
  async upsert(subscription: Subscription): Promise<Subscription> {
    await db().collection('subscriptions').doc(subscription.tenantId).set(subscription, { merge:false });
    return subscription;
  }
}

export class FirestoreUsageRepository implements UsageRepository {
  async find(tenantId: string, metric: string, periodKey: string): Promise<UsageCounter | null> {
    const doc = await db().collection('usageCounters').doc(`${tenantId}_${periodKey}_${metric}`).get();
    if (!doc.exists) return null;
    const value = doc.data() as UsageCounter;
    return value.tenantId === tenantId ? value : null;
  }
  async upsert(counter: UsageCounter): Promise<UsageCounter> {
    await db().collection('usageCounters').doc(counter.id).set(counter, { merge:false });
    return counter;
  }
}
