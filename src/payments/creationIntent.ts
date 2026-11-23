import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import {getFirestore} from 'firebase-admin/firestore';
import {ApplicationError} from '../infrastructure/errors';

export interface PaymentCreationIntent {
 tenantId:string;paymentId:string;quoteId:string;method:string;providerId:string;createdAt:string;
}
export interface PaymentCreationIntentRepository {
 /** Must be an atomic create-only operation; never silently overwrite a prior attempt. */
 reserve(intent:PaymentCreationIntent):Promise<void>;
}
export class FirestorePaymentCreationIntentRepository implements PaymentCreationIntentRepository {
 async reserve(intent:PaymentCreationIntent):Promise<void> {
  ensureFirebaseAdminApp();
  try {await getFirestore(ensureFirebaseAdminApp()).collection('paymentCreationIntents').doc(intent.paymentId).create(intent);}
  catch {
   throw new ApplicationError({category:'CONFLICT',code:'PAYMENT_CREATION_UNCERTAIN',
    message:'A previous payment attempt is already recorded. Reconcile with its provider before retrying.'});
  }
 }
}
export class InMemoryPaymentCreationIntentRepository implements PaymentCreationIntentRepository {
 private readonly keys=new Set<string>();
 async reserve(intent:PaymentCreationIntent):Promise<void>{
  if(this.keys.has(intent.paymentId))throw new ApplicationError({
   category:'CONFLICT',code:'PAYMENT_CREATION_UNCERTAIN',message:'Payment attempt already recorded.'});
  this.keys.add(intent.paymentId);
 }
}
