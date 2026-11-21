import {createBankPaymentRuntime} from '../src/payments/bankRuntime';
import {FirestoreReconciliationRepository,PaymentReconciliationWorker} from '../src/payments/reconciliation';
/** Run as a separate scheduled single-shot worker (e.g. cron every 5 minutes). */
const {service}=createBankPaymentRuntime();
const worker=new PaymentReconciliationWorker(new FirestoreReconciliationRepository(),service);
worker.runOnce(100).then(result=>{
 console.info(JSON.stringify({event:'payment_reconciliation_completed',...result}));
 if(result.failed)process.exitCode=1;
}).catch(error=>{
 console.error('payment_reconciliation_failed',error instanceof Error?error.name:'unknown');
 process.exitCode=1;
});
