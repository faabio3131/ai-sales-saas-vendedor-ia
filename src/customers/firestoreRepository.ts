import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { CustomerMemoryRepository, CustomerRepository } from './contracts';
import { Customer, CustomerMemory, ExternalIdentity } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

function identityKey(identity: ExternalIdentity): string {
  return `${identity.source.trim().toLowerCase()}:${identity.value.trim().toLowerCase()}`;
}

export class FirestoreCustomerRepository implements CustomerRepository {
  async listByTenant(tenantId: string): Promise<Customer[]> {
    const snapshot = await db().collection('customers').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as Customer);
  }

  async findById(tenantId: string, id: string): Promise<Customer | null> {
    const doc = await db().collection('customers').doc(id).get();
    if (!doc.exists) return null;
    const customer = doc.data() as Customer;
    return customer.tenantId === tenantId ? customer : null;
  }

  async findByExternalIdentity(tenantId: string, identity: ExternalIdentity): Promise<Customer | null> {
    const key = identityKey(identity);
    const snapshot = await db().collection('customers')
      .where('tenantId', '==', tenantId)
      .where('externalIdentityKeys', 'array-contains', key)
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    const raw = snapshot.docs[0].data();
    const { externalIdentityKeys: _ignored, ...customer } = raw;
    return customer as Customer;
  }

  async create(customer: Customer): Promise<Customer> {
    await db().collection('customers').doc(customer.id).create({
      ...customer,
      externalIdentityKeys: customer.externalIdentities.map(identityKey),
    });
    return customer;
  }

  async update(customer: Customer): Promise<Customer> {
    await db().collection('customers').doc(customer.id).set({
      ...customer,
      externalIdentityKeys: customer.externalIdentities.map(identityKey),
    }, { merge: false });
    return customer;
  }
}

export class FirestoreCustomerMemoryRepository implements CustomerMemoryRepository {
  async findByCustomer(tenantId: string, customerId: string): Promise<CustomerMemory | null> {
    const doc = await db().collection('customerMemories').doc(`${tenantId}_${customerId}`).get();
    if (!doc.exists) return null;
    const memory = doc.data() as CustomerMemory;
    return memory.tenantId === tenantId && memory.customerId === customerId ? memory : null;
  }

  async upsert(memory: CustomerMemory): Promise<CustomerMemory> {
    await db().collection('customerMemories').doc(`${memory.tenantId}_${memory.customerId}`).set(memory, { merge: false });
    return memory;
  }
}
