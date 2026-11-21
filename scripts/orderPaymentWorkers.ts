import { createOrderPaymentRuntime } from '../src/orderPayments/runtime';
import { FirestoreOrderPaymentOutboxRepository,FirestoreOrderFinancialEventConsumer,
  OrderPaymentOutboxWorker } from '../src/orderPayments/outbox';
import { FirestoreOrderPaymentReconciliationRepository,
  OrderPaymentReconciliationWorker } from '../src/orderPayments/reconciliation';

/** One bounded, on-demand iteration; schedule with independently approved
 * Contabo/cloud cron and workload identity. No endless loop in HTTP runtime.
 */
export async function executeOrderPaymentWorkers(){
  const runtime=createOrderPaymentRuntime();
  const reconciliation=new OrderPaymentReconciliationWorker(
    new FirestoreOrderPaymentReconciliationRepository(),runtime.service);
  const outbox=new OrderPaymentOutboxWorker(
    new FirestoreOrderPaymentOutboxRepository(),new FirestoreOrderFinancialEventConsumer());
  const payments=await reconciliation.runOnce(100);
  const events=await outbox.runOnce(100);
  return {payments,events};
}
if(process.argv[1]&&/order-payment-workers(?:\.ts|\.cjs)$/.test(process.argv[1])){
  executeOrderPaymentWorkers().then(result=>{
    console.log(JSON.stringify({type:'order-payment-worker-completed',...result}));
    if(result.payments.failed||result.payments.manualReview||result.events.failed)
      process.exitCode=1;
  }).catch(()=>{
    console.error(JSON.stringify({type:'order-payment-worker-failed'}));
    process.exitCode=1;
  });
}
