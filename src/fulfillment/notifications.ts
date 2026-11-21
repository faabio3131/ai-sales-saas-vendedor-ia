import {ChannelService} from '../channels/service';
import type {ChannelInterface} from '../channels/contracts';
import type {CustomerRepository} from '../customers/contracts';
import {FirestoreCustomerRepository} from '../customers/firestoreRepository';
import type {OperationEvent,OperationRecord,CustomerNoticePort} from './model';
import {rejected} from './policy';

export class ChannelCustomerNoticePort implements CustomerNoticePort{
 constructor(private readonly channel:ChannelService,
   private readonly customers:Pick<CustomerRepository,'findById'>){}
 async send(event:OperationEvent,operation:OperationRecord):Promise<void>{
  if(event.tenantId!==operation.tenantId||event.unitId!==operation.unitId||
    event.orderId!==operation.orderId||event.customerId!==operation.customerId||
    event.operationVersion>operation.version)
    rejected('FULFILLMENT_NOTIFICATION_SCOPE_INVALID','FORBIDDEN');
  const person=await this.customers.findById(operation.tenantId,operation.customerId);
  const verified=person?.externalIdentities.find(i=>i.source==='WHATSAPP_VERIFIED');
  if(person?.status!=='ACTIVE'||!verified?.value.trim()||
    verified.value!==person.phone)
    rejected('FULFILLMENT_CUSTOMER_CHANNEL_NOT_VERIFIED','PROVIDER');
  const number=operation.orderNumber;
  const templates:Partial<Record<OperationEvent['name'],string>>={
    OrderReady:operation.fulfillment.kind==='PICKUP'?
      'Seu pedido nº '+number+' está pronto para retirada.':
      'Seu pedido nº '+number+' está pronto e aguarda a saída para entrega.',
    DeliveryDispatched:'Seu pedido nº '+number+' saiu para entrega. Não há rastreamento GPS ao vivo.',
    DeliveryCompleted:'Seu pedido nº '+number+' foi registrado como entregue.',
    OrderPickupCompleted:'Seu pedido nº '+number+' foi registrado como retirado.',
    OrderReleasedToProduction:'Seu pedido nº '+number+' foi encaminhado à produção.',
  };
  const body=templates[event.name];
  if(!body)rejected('FULFILLMENT_NOTICE_EVENT_UNSUPPORTED');
  const response=await this.channel.send({
    tenantId:operation.tenantId,channel:'WHATSAPP',recipient:verified.value,
    type:'TEXT',text:body,idempotencyKey:event.id,
    metadata:{orderId:operation.orderId,unitId:operation.unitId,
      event:event.name,source:'PERSISTED_OPERATION_EVENT'},
  });
  if(!response.ok||!response.data?.externalMessageId)
    rejected('FULFILLMENT_CUSTOMER_SEND_FAILED','PROVIDER');
 }
}
export function createCustomerNoticePort(adapters:ChannelInterface[]=[]){
 return new ChannelCustomerNoticePort(new ChannelService(adapters),
   new FirestoreCustomerRepository());
}
