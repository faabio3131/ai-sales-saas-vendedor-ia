import {describe,it,expect} from 'vitest';
const enabled=process.env.T13_FIRESTORE_RULES_EMULATOR==='true';
if(enabled&&(
 process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8090'||
 process.env.FIREBASE_PROJECT_ID!=='demo-atendevende-t13'||
 process.env.NODE_ENV!=='test'))throw Error('T13_RULES_EMULATOR_WRONG_TARGET');
const base='http://127.0.0.1:8090/v1/projects/demo-atendevende-t13/databases/(default)/documents';
describe.skipIf(!enabled)('T13 deployed-candidate Firestore client rules security',()=>{
 for(const collection of ['payments','merchantPaymentConnections','paymentWebhookEvents',
  'governanceToolReceipts','governanceApprovals','salesFiscalHandoffs',
  'fiscalPaymentEvents','multisectorFiscalIntents','orderPaymentOutbox',
  'verifiedWebhookDeliveries','governanceRecoveryCursors','merchantEvolutionConnections',
  'evolutionPhoneReservations','evolutionInboundInbox','evolutionContactPreferences','evolutionAttendanceOutbox']){
  it('denies anonymous direct read/write: '+collection,async()=>{
   const url=base+'/'+collection+'/crossTenantRestricted';
   const read=await fetch(url);
   expect(read.status).toBe(403);
   const write=await fetch(base+'/'+collection+'?documentId=crossTenantRestricted',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({fields:{tenantId:{stringValue:'other-tenant'}}}),
   });
   expect(write.status).toBe(403);
  },20000);
 }
});
