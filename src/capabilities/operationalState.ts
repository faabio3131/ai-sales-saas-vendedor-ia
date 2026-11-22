import {getFirestore} from 'firebase-admin/firestore';
import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import type {CapabilityAssignment} from './model';

export interface CapabilityOperationalState {
 hasOpenOrders(tenantId:string,unitId:string):Promise<boolean>;
}
/** Read scoped pending orders; fail closed on ambiguity, no reading of a foreign tenant. */
export class FirestoreCapabilityOperationalState implements CapabilityOperationalState{
 async hasOpenOrders(t:string,u:string){
  const query=await getFirestore(ensureFirebaseAdminApp()).collection('orders')
   .where('tenantId','==',t).where('unitId','==',u)
   .where('status','==','CONFIRMED').limit(201).get();
  return query.size>200||query.docs.some(d=>d.get('productionState')!=='COMPLETED');
 }
}
export function blocksActiveFoodOperations(
 previous:CapabilityAssignment|undefined,next:CapabilityAssignment,
):boolean{
 if(next.vertical!=='FOOD_SERVICE'&&previous?.vertical!=='FOOD_SERVICE')return false;
 if(!previous)return true;
 return previous.templateId!==next.templateId||
  previous.vertical!==next.vertical||
  previous.operationMode!==next.operationMode||
  previous.enabledCapabilities.length!==next.enabledCapabilities.length||
  previous.enabledCapabilities.some(id=>!next.enabledCapabilities.includes(id));
}
