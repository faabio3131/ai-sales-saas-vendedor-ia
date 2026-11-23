import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import { getFirestore } from 'firebase-admin/firestore';
import { SalesFiscalHandoffRepository } from './contracts';
import {ApplicationError} from '../infrastructure/errors';
import { SalesFiscalHandoff } from './model';

function db() {
  ensureFirebaseAdminApp();
  return getFirestore(ensureFirebaseAdminApp());
}

export class FirestoreSalesFiscalHandoffRepository implements SalesFiscalHandoffRepository {
  async findByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<SalesFiscalHandoff | null> {
    const snapshot = await db()
      .collection('salesFiscalHandoffs')
      .where('tenantId', '==', tenantId)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    return snapshot.empty ? null : snapshot.docs[0].data() as SalesFiscalHandoff;
  }

  async create(handoff: SalesFiscalHandoff): Promise<SalesFiscalHandoff> {
    const ref=db().collection('salesFiscalHandoffs').doc(handoff.id);
    return db().runTransaction(async tx=>{
      const previous=(await tx.get(ref)).data() as SalesFiscalHandoff|undefined;
      if(previous){
        if(previous.tenantId!==handoff.tenantId||previous.paymentId!==handoff.paymentId||
           previous.quoteId!==handoff.quoteId||previous.customerId!==handoff.customerId||
           previous.idempotencyKey!==handoff.idempotencyKey||
           previous.amountMinor!==handoff.amountMinor||
           previous.currency!==handoff.currency||
           previous.paymentConfirmedAt!==handoff.paymentConfirmedAt)
          throw new ApplicationError({category:'CONFLICT',code:'FISCAL_HANDOFF_IDEMPOTENCY_CONFLICT',
            message:'Conflicting fiscal payment evidence.'});
        return previous;
      }
      tx.create(ref,handoff);
      return handoff;
    });
  }
}
