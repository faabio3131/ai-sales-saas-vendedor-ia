import {createFulfillmentRuntime} from '../src/fulfillment/runtime';
export async function runFulfillmentCycle(){
 const {worker}=createFulfillmentRuntime();
 return worker.runOnce(50);
}
if(process.argv[1]&&/fulfillment-worker(?:\.ts|\.cjs)$/.test(process.argv[1])){
 runFulfillmentCycle().then(result=>{
  console.log(JSON.stringify({type:'fulfillment_cycle_completed',...result}));
  if(result.retried>0)process.exitCode=1;
 }).catch(()=>{
  console.error(JSON.stringify({type:'fulfillment_cycle_failed'}));
  process.exitCode=1;
 });
}
