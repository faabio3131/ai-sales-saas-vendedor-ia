import {getFirestore,FieldPath} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../src/infrastructure/firebaseAdmin';
import {FirestoreScheduleRepository} from '../src/scheduling/firestoreRepository';
import {SchedulingService} from '../src/scheduling/service';
import {FirestoreCustomerRepository} from '../src/customers/firestoreRepository';

export async function runSchedulingCycle(){
 const db=getFirestore(ensureFirebaseAdminApp());
 const service=new SchedulingService(new FirestoreScheduleRepository(),new FirestoreCustomerRepository());
 const units=db.collection('schedulingUnits');
 let cursor:string|undefined,processed=0,expired=0,ready=0,missed=0,failed=0;
 for(;;){
  const query=units.orderBy(FieldPath.documentId()).limit(100);
  const page=await (cursor?query.startAfter(cursor):query).get();
  if(page.empty)break;
  for(const doc of page.docs){
   const tenantId=doc.get('tenantId'),unitId=doc.get('unitId');
   if(typeof tenantId!=='string'||typeof unitId!=='string'){failed++;continue;}
   try{
    // Each cycle is bounded per unit; pending backlog is resumed next cycle.
    for(let i=0;i<10;i++){
     const result=await service.maintainDue({tenantId,unitId});
     expired+=result.expired;ready+=result.ready;missed+=result.missed;
     if(!result.more)break;
    }
    processed++;
   }catch{failed++;}
  }
  cursor=page.docs.at(-1)!.id;
  if(page.size<100)break;
 }
 return {processed,expired,ready,missed,failed};
}
if(process.argv[1]&&/scheduling-worker(?:\.ts|\.cjs)$|schedulingWorker\.ts$/.test(process.argv[1])){
 runSchedulingCycle().then(result=>{
  console.log(JSON.stringify({type:'scheduling_cycle_completed',...result}));
  if(result.failed)process.exitCode=1;
 }).catch(()=>{console.error(JSON.stringify({type:'scheduling_cycle_failed'}));process.exitCode=1;});
}
