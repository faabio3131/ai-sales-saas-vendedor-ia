import {ChannelService} from '../channels/service';
import {createWhatsAppDeliveryService,type WhatsAppSendInput} from '../channels/whatsappDelivery';
import type {ChannelInterface} from '../channels/contracts';
import type {CustomerRepository} from '../customers/contracts';
import {FirestoreCustomerRepository} from '../customers/firestoreRepository';
import type {OperationEvent,OperationRecord,CustomerNoticePort} from './model';
import {rejected} from './policy';
import {FirestoreVerifiedCustomerChannelRepository,type VerifiedCustomerChannelRepository} from './trustedChannelIdentity';

export interface OfficialNoticeSender {
 send(input:WhatsAppSendInput):Promise<{externalMessageId:string;duplicate:boolean}>;
}
export class ChannelCustomerNoticePort implements CustomerNoticePort{
 constructor(private readonly channel:ChannelService,
   private readonly customers:Pick<CustomerRepository,'findById'>,
   private readonly identities:VerifiedCustomerChannelRepository=new FirestoreVerifiedCustomerChannelRepository(),
   private readonly official?:OfficialNoticeSender){}
 async send(event:OperationEvent,operation:OperationRecord):Promise<void>{
  if(event.tenantId!==operation.tenantId||event.unitId!==operation.unitId||
    event.orderId!==operation.orderId||event.customerId!==operation.customerId||
    event.operationVersion>operation.version)
    rejected('FULFILLMENT_NOTIFICATION_SCOPE_INVALID','FORBIDDEN');
  const [person,verified]=await Promise.all([
    this.customers.findById(operation.tenantId,operation.customerId),
    this.identities.get(operation.tenantId,operation.customerId,'WHATSAPP'),
  ]);
  // Customer.externalIdentities is user-writable via CRM. Only a separate
  // signed-provider trust record can authorize an outbound WhatsApp notice.
  if(person?.status!=='ACTIVE'||!verified||verified.revokedAt||
    verified.tenantId!==operation.tenantId||
    verified.customerId!==operation.customerId||
    verified.channel!=='WHATSAPP'||verified.provenance!=='SIGNED_PROVIDER_WEBHOOK'||
    !verified.proofRef||!Number.isFinite(Date.parse(verified.verifiedAt))||
    verified.recipient!==person.phone)
    rejected('FULFILLMENT_CUSTOMER_CHANNEL_NOT_VERIFIED','PROVIDER');
  const number=operation.orderNumber;
  const templates:Partial<Record<OperationEvent['name'],string>>={
    ProductionStarted:'Seu pedido nº '+number+' entrou em preparo.',
    OrderReady:operation.fulfillment.kind==='PICKUP'?
      'Seu pedido nº '+number+' está pronto para retirada.':
      'Seu pedido nº '+number+' está pronto e aguarda a saída para entrega.',
    DeliveryDispatched:'Seu pedido nº '+number+' saiu para entrega. Não há rastreamento GPS ao vivo.',
    DeliveryCompleted:'Seu pedido nº '+number+' foi registrado como entregue.',
    OrderPickupCompleted:'Seu pedido nº '+number+' foi registrado como retirado.',
    OrderReleasedToProduction:'Seu pedido nº '+number+' foi confirmado e encaminhado à produção.',
  };
  const body=templates[event.name];
  if(!body)rejected('FULFILLMENT_NOTICE_EVENT_UNSUPPORTED');
  // Production must always use the official tenant+unit-bound delivery service.
  // That service independently enforces live flags, verified signed inbound
  // within 24h, active Meta account, vault binding and durable idempotency.
  if(this.official){
    const result=await this.official.send({
      tenantId:operation.tenantId,unitId:operation.unitId,
      recipient:verified.recipient,text:body,idempotencyKey:event.id,
      authorizedCustomerServiceWindow:true,
    });
    if(!result.externalMessageId)rejected('FULFILLMENT_CUSTOMER_SEND_FAILED','PROVIDER');
    return;
  }
  // Explicit test doubles preserve older T06 contract tests. They cannot
  // silently become the real sender because the runtime requires 'official'.
  if(process.env.NODE_ENV!=='test')
    rejected('FULFILLMENT_OFFICIAL_WHATSAPP_REQUIRED','PROVIDER');
  const response=await this.channel.send({
    tenantId:operation.tenantId,channel:'WHATSAPP',recipient:verified.recipient,
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
   new FirestoreCustomerRepository(),new FirestoreVerifiedCustomerChannelRepository(),
   createWhatsAppDeliveryService());
}
