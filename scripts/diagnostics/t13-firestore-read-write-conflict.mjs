// Diagnostic only: external update of a document read by a transaction that
// writes a different document. No domain import, production credentials, or retry wrapper.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Firestore} from '@google-cloud/firestore';
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
assert.equal(process.env.FIREBASE_PROJECT_ID,'demo-atendevende-t10');
assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const options={projectId:'demo-atendevende-t10',host:'127.0.0.1:8089',ssl:false};
const txClient=new Firestore(options),writerClient=new Firestore(options);
let failures=0;
try{
 for(let rep=1;rep<=3;rep++){
  const id=randomUUID(),source=txClient.collection('sdkReadWriteConflict').doc(id+'-source'),target=txClient.collection('sdkReadWriteConflict').doc(id+'-target');
  await source.create({value:0});
  let signal;
  const readReady=new Promise(resolve=>{signal=resolve});
  let writerCommitted=false,attempts=0,staleAfterWriter=false;
  const outside=(async()=>{
   await readReady;
   await writerClient.doc(source.path).update({value:1});
   writerCommitted=true;
  })();
  const transaction=txClient.runTransaction(async tx=>{
   attempts++;
   const snap=await tx.get(source),value=snap.get('value');
   if(attempts===1){
    signal();
    // Either the independent update waits for the transaction, or a conflict
    // must invalidate any stale read before it can commit a dependent write.
    await Promise.race([outside,delay(800)]);
    staleAfterWriter=writerCommitted&&value===0;
   }
   tx.create(target,{value});
   return value;
  });
  const settled=await Promise.allSettled([transaction,outside]);
  const [src,dst]=await txClient.getAll(source,target);
  const passed=settled.every(r=>r.status==='fulfilled')&&src.get('value')===1&&dst.exists&&
   (dst.get('value')===0||dst.get('value')===1)&&(!staleAfterWriter||dst.get('value')===1&&attempts>1);
  console.log('SDK_READ_WRITE_CONFLICT '+JSON.stringify({rep,attempts,staleAfterWriter,source:src.get('value'),target:dst.get('value'),results:settled.map(r=>r.status==='fulfilled'?{status:r.status}:{status:r.status,code:r.reason?.code,message:String(r.reason?.message??'').slice(0,240)}),passed}));
  if(!passed)failures++;
 }
}finally{await Promise.all([txClient.terminate(),writerClient.terminate()]);}
console.log('SDK_READ_WRITE_CONFLICT_FAILURES='+failures);
if(failures)process.exitCode=1;
