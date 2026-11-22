/** Scheduled governance reconciliation entrypoint.
 * Safe to re-run: transitions stale RESERVED to REVIEW_REQUIRED only.
 * Configure the deployment scheduler to invoke this worker periodically.
 */
import {FirestoreGovernanceRepository} from '../src/governance/repository';
async function main(){
 const store=new FirestoreGovernanceRepository();
 const summary=await store.reconcileStaleReservations(new Date().toISOString());
 process.stdout.write(JSON.stringify({event:'governance_stale_receipts_reconciled',...summary})+'\n');
}
main().catch(error=>{
 process.stderr.write(JSON.stringify({event:'governance_reconciliation_failed',
  message:error instanceof Error?error.message:'UNKNOWN'})+'\n');
 process.exitCode=1;
});
