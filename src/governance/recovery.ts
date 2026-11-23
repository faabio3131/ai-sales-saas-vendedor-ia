import {getFirestore,FieldPath} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {ToolReceipt} from './model';

/** A stale RESERVED receipt is quarantined, never replayed. */
export interface StaleGovernanceReceiptStore {
 listReserved(limit:number):Promise<ToolReceipt[]>;
 quarantine(receipt:ToolReceipt,before:string):Promise<boolean>;
}
const firestore=()=>getFirestore(ensureFirebaseAdminApp());
export class FirestoreStaleGovernanceReceiptStore implements StaleGovernanceReceiptStore {
 async listReserved(limit:number):Promise<ToolReceipt[]> {
  const db=firestore();
  const cursorRef=db.collection('governanceRecoveryCursors').doc('reserved');
  const saved=(await cursorRef.get()).data() as {afterId?:string}|undefined;
  const base=db.collection('governanceToolReceipts').where('status','==','RESERVED')
   .orderBy(FieldPath.documentId()).limit(Math.min(250,Math.max(1,Math.floor(limit))));
  let page=await (saved?.afterId?base.startAfter(saved.afterId):base).get();
  if(page.empty&&saved?.afterId){
   await cursorRef.delete();
   page=await base.get();
  }
  if(!page.empty){
   await cursorRef.set({afterId:page.docs[page.docs.length-1].id,
    updatedAt:new Date().toISOString()},{merge:true});
  }
  return page.docs.map(d=>d.data() as ToolReceipt);
 }
 async quarantine(receipt:ToolReceipt,before:string):Promise<boolean>{
  const ref=firestore().collection('governanceToolReceipts').doc(receipt.id);
  return firestore().runTransaction(async tx=>{
   const old=(await tx.get(ref)).data() as ToolReceipt|undefined;
   if(!old||old.id!==receipt.id||old.tenantId!==receipt.tenantId||
      old.unitId!==receipt.unitId||old.actorId!==receipt.actorId||
      old.requestHash!==receipt.requestHash||old.status!=='RESERVED'||
      typeof old.updatedAt!=='string'||old.updatedAt>before)return false;
   tx.set(ref,{...old,status:'REVIEW_REQUIRED',updatedAt:new Date().toISOString(),
    failureCode:'AUTONOMY_STALE_RESERVATION_REQUIRES_RECONCILIATION'});
   return true;
  });
 }
}
export class GovernedReceiptRecoveryWorker {
 constructor(private readonly store:StaleGovernanceReceiptStore,
  private readonly now:()=>number=Date.now){}
 async runOnce(limit=100,staleMs=30*60_000){
  const before=new Date(this.now()-staleMs).toISOString();
  const summary={scanned:0,quarantined:0,skipped:0,failed:0};
  const rows=await this.store.listReserved(limit);
  for(const row of rows){
   summary.scanned++;
   if(row.status!=='RESERVED'||!row.updatedAt||row.updatedAt>before){
    summary.skipped++;continue;
   }
   try{
    if(await this.store.quarantine(row,before))summary.quarantined++;
    else summary.skipped++;
   }catch{summary.failed++;}
  }
  return summary;
 }
}
