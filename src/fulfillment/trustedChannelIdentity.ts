import {createHash} from 'node:crypto';
import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
export interface VerifiedCustomerChannel {
 tenantId:string;customerId:string;channel:'WHATSAPP';
 recipient:string;verifiedAt:string;
 provenance:'SIGNED_PROVIDER_WEBHOOK';proofRef:string;
 revokedAt?:string;
}
/** Separate trust store, not editable through customer CRUD. */
export interface VerifiedCustomerChannelRepository {
 get(tenantId:string,customerId:string,channel:'WHATSAPP'):
  Promise<VerifiedCustomerChannel|null>;
}
export class FirestoreVerifiedCustomerChannelRepository
implements VerifiedCustomerChannelRepository{
 async get(tenantId:string,customerId:string,channel:'WHATSAPP'){
  const key=createHash('sha256').update(JSON.stringify([tenantId,customerId,channel]))
   .digest('hex');
  const document=await getFirestore(ensureFirebaseAdminApp())
   .collection('trustedCustomerChannelIdentities').doc(key).get();
  const data=document.data() as VerifiedCustomerChannel|undefined;
  if(!data||data.tenantId!==tenantId||data.customerId!==customerId||
    data.channel!==channel||data.revokedAt||
    data.provenance!=='SIGNED_PROVIDER_WEBHOOK'||!data.proofRef||
    !Number.isFinite(Date.parse(data.verifiedAt))||
    !/^55\d{10,11}$/.test(data.recipient))return null;
  return data;
 }
}
