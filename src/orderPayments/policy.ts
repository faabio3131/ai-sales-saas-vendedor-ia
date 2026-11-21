import { ApplicationError } from '../infrastructure/errors';
import type { TenantContext } from '../types/contracts';
import type { Order } from '../orders/model';
import type { OrderPayment } from './model';

export function denyPayment(code:string,category:'FORBIDDEN'|'CONFLICT'|'VALIDATION'|'NOT_FOUND'|'PROVIDER'='CONFLICT'):never{
  throw new ApplicationError({category,code,message:'Payment action not authorized or cannot be completed.'});
}
export function paymentId(value:unknown):string{
  if(typeof value!=='string'||! /^(?=.{6,128}$)[a-zA-Z0-9_:-]+$/.test(value))
    denyPayment('ORDER_PAYMENT_ID_INVALID','VALIDATION');
  return value as string;
}
export function safeInteger(value:unknown,min=0,max=1_000_000_000):number{
  if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)
    denyPayment('ORDER_PAYMENT_AMOUNT_INVALID','VALIDATION');
  return value as number;
}
export function allowKeys(payload:unknown,keys:string[]):void{
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    Object.keys(payload).some(x=>!keys.includes(x)))
    denyPayment('ORDER_PAYMENT_FIELDS_INVALID','VALIDATION');
}
export class OrderPaymentPolicyEngine {
  operator(ctx:TenantContext):void{
    if(!ctx.tenantId?.trim()||!ctx.userId?.trim()||
      !['OWNER','ADMIN','MANAGER','ATTENDANT','OPERATOR','STAFF','CASHIER'].includes(ctx.role??''))
      denyPayment('ORDER_PAYMENT_OPERATOR_DENIED','FORBIDDEN');
  }
  owner(ctx:TenantContext):void{
    if(!ctx.userId?.trim()||!['OWNER','ADMIN'].includes(ctx.role??''))
      denyPayment('ORDER_PAYMENT_OWNER_REQUIRED','FORBIDDEN');
  }
  collect(ctx:TenantContext):void{
    if(!ctx.userId?.trim()||!['OWNER','ADMIN','MANAGER','CASHIER'].includes(ctx.role??''))
      denyPayment('ORDER_PAYMENT_COLLECTION_ROLE_DENIED','FORBIDDEN');
  }
  create(ctx:TenantContext,order:Order):void{
    this.operator(ctx);
    if(order.tenantId!==ctx.tenantId)denyPayment('ORDER_PAYMENT_SCOPE_DENIED','FORBIDDEN');
    if(order.status!=='CONFIRMED'||!order.customerConfirmation||
      order.customerConfirmation.totalMinor!==order.totalMinor||
      order.totalMinor<=0||!Number.isSafeInteger(order.totalMinor))
      denyPayment('ORDER_PAYMENT_REQUIRES_CONFIRMED_ORDER');
    if(order.paymentState!=='NOT_REQUESTED')denyPayment('ORDER_PAYMENT_ALREADY_STARTED');
  }
  verifyScope(ctx:TenantContext,record:OrderPayment,unitId:string):void{
    this.operator(ctx);
    if(record.tenantId!==ctx.tenantId||record.unitId!==unitId)
      denyPayment('ORDER_PAYMENT_SCOPE_DENIED','FORBIDDEN');
  }
}
