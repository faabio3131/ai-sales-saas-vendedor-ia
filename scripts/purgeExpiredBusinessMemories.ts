import { FirestoreScopedMemoryRepository } from '../src/business/firestoreRepository';

/** Scheduled controlled cleanup, uses the existing authorized Firestore workload identity.
 * Run only in an operator-approved private environment; never on every HTTP request.
 */
export async function purgeExpiredBusinessMemories(
  repository=new FirestoreScopedMemoryRepository(),
  now:()=>Date=()=>new Date(),
  maxBatches=20,
):Promise<number>{
  if(!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>100)throw new Error('Invalid purge batch budget.');
  const timestamp=now().toISOString();
  let removed=0;
  for(let batch=0;batch<maxBatches;batch++){
    const deleted=await repository.purgeExpired(timestamp,100);
    if(!Number.isSafeInteger(deleted)||deleted<0||deleted>100)throw new Error('Invalid purge report.');
    removed+=deleted;
    if(deleted<100)break;
  }
  return removed;
}
if(process.argv[1] && /purge-business-memories(?:\.cjs|\.ts)$/.test(process.argv[1])){
  purgeExpiredBusinessMemories().then(count=>{
    console.log(JSON.stringify({event:'business_memory_purge_completed',removed:count}));
  }).catch(()=>{
    console.error('business_memory_purge_failed');
    process.exitCode=1;
  });
}
