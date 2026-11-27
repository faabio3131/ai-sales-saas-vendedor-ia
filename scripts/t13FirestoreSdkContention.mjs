// Permanent isolated SDK acceptance control derived from the successful SDK-only counterproof.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {Firestore} from '@google-cloud/firestore';
import {randomUUID} from 'node:crypto';
assert.equal(process.env.NODE_ENV,'test');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8089');
assert.equal(process.env.FIREBASE_PROJECT_ID,'demo-atendevende-t10');
assert(!process.env.GOOGLE_APPLICATION_CREDENTIALS);
const scope=process.env.DIAG_SCOPE,reads=process.env.DIAG_READS;
assert(['shared','disjoint'].includes(scope));assert(['parallel','batched'].includes(reads));
const options={projectId:'demo-atendevende-t10',host:'127.0.0.1:8089',ssl:false};
const admin=new Firestore(options);
const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
console.log('SDK_VERSION '+lock.packages['node_modules/@google-cloud/firestore'].version);
const req=createRequire(import.meta.url);
const transactionSource=path.join(path.dirname(req.resolve('@google-cloud/firestore')),'transaction.js');
if(fs.existsSync(transactionSource)){
 const src=fs.readFileSync(transactionSource,'utf8');
 const i=src.indexOf('function isRetryableTransactionError(');
 if(i>=0)console.log('SDK_RETRY_POLICY '+src.slice(i,i+1900));
}
let failed=0;
try{
 for(const n of [3,8])for(let rep=1;rep<=3;rep++){
  const prefix='diag_'+randomUUID().replaceAll('-','');
  const clients=Array.from({length:n},()=>new Firestore(options));
  const keys=Array.from({length:scope==='shared'?1:n},(_,i)=>prefix+'_'+i);
  const attempts=Array(n).fill(0);
  const row=(db,key,suffix)=>db.collection('sdkContentionTest').doc(key+'_'+suffix);
  // Each run uses synthetic documents and independent SDK clients. Shared case
  // competes on same receipt, guard, CRM and message. Disjoint case shares none.
  const batch=admin.batch();
  for(const key of keys)batch.create(row(admin,key,'guard'),{active:true});
  await batch.commit();
  const start=Date.now();
  const group=(tx,...refs)=>reads==='batched'?tx.getAll(...refs):Promise.all(refs.map(r=>tx.get(r)));
  const settled=await Promise.allSettled(clients.map((db,i)=>{
   const key=keys[scope==='shared'?0:i];
   return db.runTransaction(async tx=>{
    attempts[i]++;
    const [prior,guard]=await group(tx,row(db,key,'receipt'),row(db,key,'guard'));
    assert.equal(guard.get('active'),true);
    if(prior.exists){assert.equal(prior.get('event'),'fixture');return false;}
    const [crm,msg]=await group(tx,row(db,key,'crm'),row(db,key,'message'));
    assert(!crm.exists&&!msg.exists);
    tx.create(row(db,key,'crm'),{fixture:true});
    tx.create(row(db,key,'message'),{fixture:true});
    tx.create(row(db,key,'receipt'),{event:'fixture'});
    return true;
   });
  }));
  const rejected=settled.filter(x=>x.status==='rejected');
  const created=settled.filter(x=>x.status==='fulfilled'&&x.value===true).length;
  const refs=keys.flatMap(k=>['guard','receipt','crm','message'].map(s=>row(admin,k,s)));
  let verified=0,readbackError=false;
  try{
   const snaps=await admin.getAll(...refs);
   verified=snaps.filter((x,i)=>x.exists&&(i%4===0?x.get('active')===true:i%4===1?x.get('event')==='fixture':x.get('fixture')===true)).length;
  }catch(e){readbackError=true;console.error('SDK_READBACK_ERROR '+String(e?.code??'UNKNOWN'))}
  const passed=!rejected.length&&!readbackError&&created===keys.length&&verified===refs.length;
  if(!passed)failed++;
  console.log('SDK_PROBE '+JSON.stringify({scope,reads,n,rep,elapsedMs:Date.now()-start,attempts,created,
   expectedCreated:keys.length,verified,expectedDocuments:refs.length,rejected:rejected.map(r=>({code:r.reason?.code??'UNKNOWN',message:String(r.reason?.message??'').slice(0,240)})),passed}));
  await Promise.all(clients.map(db=>db.terminate()));
 }
}finally{await admin.terminate();}
console.log('SDK_PROBE_FAILURES='+failed);
if(failed)process.exitCode=1;
