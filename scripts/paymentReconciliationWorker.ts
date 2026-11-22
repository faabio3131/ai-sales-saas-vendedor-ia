import {createBankPaymentRuntime} from '../src/payments/bankRuntime';
import {FirestoreReconciliationRepository,PaymentReconciliationWorker} from '../src/payments/reconciliation';
import {PaymentWebhookProcessor} from '../src/payments/providerWebhooks';
import {VerifiedWebhookRecoveryWorker} from '../src/payments/webhookRecovery';
import {FirestoreStaleGovernanceReceiptStore,GovernedReceiptRecoveryWorker} from '../src/governance/recovery';
import {FirestoreConfirmedSalesPaymentSource,FiscalHandoffRecoveryWorker} from '../src/fiscal/recovery';
import {SalesFiscalHandoffService} from '../src/fiscal/service';
import {FirestoreSalesFiscalHandoffRepository} from '../src/fiscal/firestoreRepository';
import {FirestoreQuoteRepository,FirestoreQuoteItemRepository} from '../src/quotes/firestoreRepository';
/** Run as a separate scheduled single-shot worker (e.g. cron every 5 minutes). */
const runtime=createBankPaymentRuntime();
const worker=new PaymentReconciliationWorker(new FirestoreReconciliationRepository(),runtime.service);
const processor=new PaymentWebhookProcessor(runtime);
const webhookWorker=new VerifiedWebhookRecoveryWorker(runtime.recovery,
 event=>processor.reconcileVerified(event));
const governanceWorker=new GovernedReceiptRecoveryWorker(new FirestoreStaleGovernanceReceiptStore());
const fiscalWorker=new FiscalHandoffRecoveryWorker(new FirestoreConfirmedSalesPaymentSource(),
 new SalesFiscalHandoffService(new FirestoreSalesFiscalHandoffRepository(),
  new FirestoreQuoteRepository(),new FirestoreQuoteItemRepository()));
Promise.all([worker.runOnce(100),webhookWorker.runOnce(100),
 governanceWorker.runOnce(100),fiscalWorker.runOnce(100)]).then(([result,webhooks,governance,fiscal])=>{
 console.info(JSON.stringify({event:'payment_reconciliation_completed',...result}));
 console.info(JSON.stringify({event:'verified_webhook_recovery_completed',...webhooks}));
 console.info(JSON.stringify({event:'governance_receipt_recovery_completed',...governance}));
 console.info(JSON.stringify({event:'fiscal_handoff_recovery_completed',...fiscal}));
 if(result.failed||webhooks.failed||governance.failed||fiscal.failed)process.exitCode=1;
}).catch(error=>{
 console.error('payment_reconciliation_failed',error instanceof Error?error.name:'unknown');
 process.exitCode=1;
});
