import fs from 'node:fs';
import assert from 'node:assert/strict';
const mode=process.argv[2];
assert(['original','batched'].includes(mode)&&process.argv.length===3);
function edit(path,pairs){
 let s=fs.readFileSync(path,'utf8');
 for(const [old,next] of pairs){
  assert.equal(s.split(old).length,2,'DIAG_ANCHOR_MISMATCH '+path+' '+old.slice(0,80));
  s=s.replace(old,next);
 }
 fs.writeFileSync(path,s);
}
const test='tests/t13EvolutionFirestoreEmulator.test.ts';
edit(test,[
 ["const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';",`async function diagConcurrent<T>(phase:string,tasks:Promise<T>[]):Promise<T[]>{
 const start=Date.now();
 const results=await Promise.allSettled(tasks);
 const rejects=results.filter(r=>r.status==='rejected');
 console.info('DIAG_PHASE '+JSON.stringify({phase,elapsedMs:Date.now()-start,attempts:tasks.length,
  fulfilled:results.length-rejects.length,rejected:rejects.length,
  errorCodes:rejects.map(r=>String(r.reason?.code??'UNKNOWN'))}));
 if(rejects.length)throw rejects[0].reason;
 return results.map(r=>(r as PromiseFulfilledResult<T>).value);
}
const enabled=process.env.T10_FIRESTORE_EMULATOR==='true';`],
 ["await Promise.all(Array.from({length:3},()=>inbound.persist(s,event.externalMessageId,event)))","await diagConcurrent('duplicate-inbound',Array.from({length:3},()=>inbound.persist(s,event.externalMessageId,event)))"],
 ["await Promise.all([store.claim(job,'claim-a',now+10),store.claim(job,'claim-b',now+10)])","await diagConcurrent('competing-claims',[store.claim(job,'claim-a',now+10),store.claim(job,'claim-b',now+10)])"]
]);
if(mode==='batched'){
 edit('src/channels/evolutionPairing.ts',[
 ["await Promise.all([tx.get(phone),tx.get(meta)])","await tx.getAll(phone,meta)"],
 ["await Promise.all([tx.get(ref),tx.get(binding)])","await tx.getAll(ref,binding)"],
 ["const claim=await tx.get(database.collection('evolutionPhoneReservations').doc(attendanceHash(b.ownerPhone)));\n   const meta=await tx.get(database.collection('merchantWhatsAppConnections').doc(channelDocId(s.tenantId,s.unitId)));","const [claim,meta]=await tx.getAll(database.collection('evolutionPhoneReservations').doc(attendanceHash(b.ownerPhone)),\n    database.collection('merchantWhatsAppConnections').doc(channelDocId(s.tenantId,s.unitId)));"]
 ]);
 edit('src/channels/evolutionAttendanceStore.ts',[
 ["await Promise.all([\n  tx.get(r.customer),tx.get(r.conversation),tx.get(r.message),tx.get(r.preference)])","await tx.getAll(r.customer,r.conversation,r.message,r.preference)"],
 ["await Promise.all([tx.get(r.conversation),tx.get(r.preference),tx.get(r.customer)])","await tx.getAll(r.conversation,r.preference,r.customer)"],
 ["await Promise.all([\n    tx.get(r.binding),tx.get(r.meta),tx.get(r.conversation),tx.get(r.preference),\n    tx.get(r.customer),tx.get(r.outbox),tx.get(r.profile),tx.get(r.capabilities),tx.get(r.subscription)])","await tx.getAll(r.binding,r.meta,r.conversation,r.preference,r.customer,r.outbox,r.profile,r.capabilities,r.subscription)"],
 ["await Promise.all([tx.get(r.outbox),tx.get(r.binding),tx.get(r.conversation)])","await tx.getAll(r.outbox,r.binding,r.conversation)"]
 ]);
}
console.log('DIAGNOSTIC_OVERLAY_APPLIED '+mode);
