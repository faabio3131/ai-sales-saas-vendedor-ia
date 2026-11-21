import {randomUUID} from 'node:crypto';
import type {OperationOutboxRepository,OperationRepository,ProductionAdapterRegistry,
  CustomerNoticePort,OperationEvent} from './model';
import {FulfillmentService} from './service';
import {rejected} from './policy';
export interface FulfillmentWorkerResult {claimed:number;delivered:number;retried:number;}
export class FulfillmentWorker {
 constructor(private readonly outbox:OperationOutboxRepository,
  private readonly operations:OperationRepository,
  private readonly service:FulfillmentService,
  private readonly adapters:ProductionAdapterRegistry,
  private readonly notices:CustomerNoticePort,
  private readonly clock:()=>number=Date.now){}
 async runOnce(limit=50):Promise<FulfillmentWorkerResult>{
  const jobs=await this.outbox.claim(this.clock(),limit);
  const result={claimed:jobs.length,delivered:0,retried:0};
  for(const job of jobs){
   if(!job.claimToken)throw new Error('Missing outbox claim fencing token');
   try{
    const op=await this.operations.get(job.tenantId,job.unitId,job.orderId);
    if(!op||op.customerId!==job.customerId||op.operationMode!==job.mode)
      rejected('FULFILLMENT_OUTBOX_ORPHANED');
    if(job.work==='DISPATCH'){
     if(op.state!=='AWAITING_ACK'&&!op.externalOrderId)
       rejected('FULFILLMENT_DISPATCH_STATE_INCONSISTENT');
     if(op.state==='AWAITING_ACK'){
      const adapter=op.connectorId?this.adapters.get(op.connectorId):null;
      if(!adapter||adapter.schemaVersion!==1||
         !await adapter.readiness(op.tenantId,op.unitId))
        rejected('FULFILLMENT_DISPATCH_CONNECTOR_UNAVAILABLE','PROVIDER');
      const message=await this.service.dispatchPayload(op);
      const ack=await adapter.dispatch(message);
      await this.service.acknowledge(op.tenantId,op.unitId,op.orderId,ack);
     }
     // After ACK was committed, replay of the job only marks delivery.
    }else{
     // No notification is attempted before the event is committed. Sends use
     // the stable event id as channel idempotency key.
     if(op.version<job.operationVersion)
       rejected('FULFILLMENT_NOTIFICATION_EVENT_NOT_COMMITTED');
     const event:OperationEvent={id:job.id,tenantId:job.tenantId,unitId:job.unitId,
      orderId:job.orderId,customerId:job.customerId,
      operationVersion:job.operationVersion,name:job.name,
      mode:job.mode,occurredAt:job.occurredAt,actorId:job.actorId};
     await this.notices.send(event,op);
    }
    await this.outbox.ack(job.id,job.claimToken,this.clock());
    result.delivered++;
   }catch{
    await this.outbox.retry(job.id,job.claimToken,this.clock(),'FULFILLMENT_WORK_FAILED',8);
    result.retried++;
   }
  }
  return result;
 }
}
export class EmptyProductionAdapterRegistry implements ProductionAdapterRegistry{
 get(_id:string){return null;}
}
export const fulfillmentWorkerId=()=>randomUUID();
