import {ensureFiscalIntentInTransaction} from '../fiscal/outbox';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PaymentRepository, PaymentWebhookEventRepository } from './contracts';
import { Payment, PaymentWebhookEvent } from './model';

function db() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    initializeApp(projectId ? { projectId } : undefined);
  }
  return getFirestore();
}

export class FirestorePaymentRepository implements PaymentRepository {
  async listByTenant(tenantId: string) {
    const s = await db().collection('payments').where('tenantId','==',tenantId).get();
    return s.docs.map(d => d.data() as Payment);
  }
  async findById(tenantId: string, id: string) {
    const d = await db().collection('payments').doc(id).get();
    if (!d.exists) return null;
    const p = d.data() as Payment;
    return p.tenantId === tenantId ? p : null;
  }
  async findByIdempotencyKey(tenantId: string, key: string) {
    const s = await db().collection('payments').where('tenantId','==',tenantId).where('idempotencyKey','==',key).limit(1).get();
    return s.empty ? null : s.docs[0].data() as Payment;
  }
  async findByProviderPaymentId(tenantId: string, provider: string, providerPaymentId: string) {
    const s = await db().collection('payments').where('tenantId','==',tenantId).where('provider','==',provider).where('providerPaymentId','==',providerPaymentId).limit(1).get();
    return s.empty ? null : s.docs[0].data() as Payment;
  }
  async create(payment: Payment) { await db().collection('payments').doc(payment.id).create(payment); return payment; }
  async update(payment: Payment) {
    if(payment.status==='CONFIRMED'&&!payment.confirmedAt)
      throw Error('PAYMENT_CONFIRMATION_TIMESTAMP_REQUIRED');
    const ref=db().collection('payments').doc(payment.id);
    await db().runTransaction(async tx=>{
      const old=(await tx.get(ref)).data() as Payment|undefined;
      if(!old||old.tenantId!==payment.tenantId||old.id!==payment.id||
         old.quoteId!==payment.quoteId||old.amountMinor!==payment.amountMinor||
         old.currency!==payment.currency||old.provider!==payment.provider||
         old.providerPaymentId!==payment.providerPaymentId||
         old.customerId!==payment.customerId||old.idempotencyKey!==payment.idempotencyKey||
         old.method!==payment.method)
        throw Error('PAYMENT_UPDATE_SCOPE_CONFLICT');
      if(old.status==='REFUNDED'&&payment.status!=='REFUNDED')
        throw Error('PAYMENT_TERMINAL_STATUS_REGRESSION');
      if(old.status==='CONFIRMED'&&old.confirmedAt!==payment.confirmedAt)
        throw Error('PAYMENT_CONFIRMATION_EVIDENCE_CONFLICT');
      if(old.status==='CONFIRMED'&&!['CONFIRMED','REFUNDED'].includes(payment.status))
        throw Error('PAYMENT_CONFIRMED_STATUS_REGRESSION');
      await ensureFiscalIntentInTransaction(tx,payment);
      tx.set(ref,payment,{merge:false});
    });
    return payment;
  }
}

export class FirestorePaymentWebhookEventRepository implements PaymentWebhookEventRepository {
  async findByEventId(tenantId: string, provider: string, eventId: string) {
    const s = await db().collection('paymentWebhookEvents').where('tenantId','==',tenantId).where('provider','==',provider).where('eventId','==',eventId).limit(1).get();
    return s.empty ? null : s.docs[0].data() as PaymentWebhookEvent;
  }
  async create(event: PaymentWebhookEvent) { await db().collection('paymentWebhookEvents').doc(event.id).create(event); return event; }
}
