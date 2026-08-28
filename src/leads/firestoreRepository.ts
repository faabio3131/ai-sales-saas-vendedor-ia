import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { LeadRepository, OpportunityRepository } from './contracts';
import { Lead, Opportunity } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestoreLeadRepository implements LeadRepository {
  async listByTenant(tenantId: string): Promise<Lead[]> {
    const snapshot = await db().collection('leads').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as Lead);
  }

  async findById(tenantId: string, id: string): Promise<Lead | null> {
    const doc = await db().collection('leads').doc(id).get();
    if (!doc.exists) return null;
    const lead = doc.data() as Lead;
    return lead.tenantId === tenantId ? lead : null;
  }

  async findActiveByCustomer(tenantId: string, customerId: string): Promise<Lead | null> {
    const snapshot = await db().collection('leads')
      .where('tenantId', '==', tenantId)
      .where('customerId', '==', customerId)
      .get();
    const leads = snapshot.docs.map((doc) => doc.data() as Lead);
    return leads.find((lead) => lead.stage !== 'FECHADO' && lead.stage !== 'PERDIDO') ?? null;
  }

  async create(lead: Lead): Promise<Lead> {
    await db().collection('leads').doc(lead.id).create(lead);
    return lead;
  }

  async update(lead: Lead): Promise<Lead> {
    await db().collection('leads').doc(lead.id).set(lead, { merge: false });
    return lead;
  }
}

export class FirestoreOpportunityRepository implements OpportunityRepository {
  async listByTenant(tenantId: string): Promise<Opportunity[]> {
    const snapshot = await db().collection('opportunities').where('tenantId', '==', tenantId).get();
    return snapshot.docs.map((doc) => doc.data() as Opportunity);
  }

  async findById(tenantId: string, id: string): Promise<Opportunity | null> {
    const doc = await db().collection('opportunities').doc(id).get();
    if (!doc.exists) return null;
    const opportunity = doc.data() as Opportunity;
    return opportunity.tenantId === tenantId ? opportunity : null;
  }

  async create(opportunity: Opportunity): Promise<Opportunity> {
    await db().collection('opportunities').doc(opportunity.id).create(opportunity);
    return opportunity;
  }

  async update(opportunity: Opportunity): Promise<Opportunity> {
    await db().collection('opportunities').doc(opportunity.id).set(opportunity, { merge: false });
    return opportunity;
  }
}
