import {FirestoreFiscalOutboxRepository,FiscalHandoffReconciliationWorker} from '../src/fiscal/outbox';
import {FirestoreGovernanceRepository} from '../src/governance/repository';
import {createBankPaymentRuntime} from '../src/payments/bankRuntime';
import {FirestoreReconciliationRepository,PaymentReconciliationWorker} from '../src/payments/reconciliation';
import {PaymentWebhookProcessor} from '../src/payments/providerWebhooks';
import {VerifiedWebhookRecoveryWorker} from '../src/payments/webhookRecovery';
/** Run as a separate scheduled single-shot worker (e.g. cron every 5 minutes). */
const runtime=createBankPaymentRuntime();
const worker=new PaymentReconciliationWorker(new FirestoreReconciliationRepository(),runtime.service);
const processor=new PaymentWebhookProcessor(runtime);
const webhookWorker=new VerifiedWebhookRecoveryWorker(runtime.recovery,
 event=>processor.reconcileVerified(event));
Promise.all([worker.runOnce(100),webhookWorker.runOnce(100),
 new FirestoreGovernanceRepository().reconcileStaleReservations(new Date().toISOString()),
 fiscalWorker.runOnce(100)])
 .then(([result,webhooks,governance,fiscal])=>{
 console.info(JSON.stringify({event:'payment_reconciliation_completed',...result}));
 console.info(JSON.stringify({event:'verified_webhook_recovery_completed',...webhooks}));
 console.info(JSON.stringify({event:'governance_reservation_reconciliation_completed',...governance}));
 console.info(JSON.stringify({event:'fiscal_handoff_reconciliation_completed',...fiscal}));
 if(result.failed||webhooks.failed||fiscal.failed)process.exitCode=1;
}).catch(error=>{
 console.error('payment_reconciliation_failed',error instanceof Error?error.name:'unknown');
 process.exitCode=1;
});
