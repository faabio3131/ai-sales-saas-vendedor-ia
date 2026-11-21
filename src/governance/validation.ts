import {createHash} from 'node:crypto';
import {ApplicationError} from '../infrastructure/errors';
import {requireBusinessScope,requireBusinessAdmin} from '../business/service';
import type {TenantContext} from '../types/contracts';
import {GOVERNED_TOOLS,type GovernedTool,type ToolRequest,type PublishAutonomyPolicy,
  type AutonomyPolicy} from './model';

export function deny(code:string,category:'VALIDATION'|'FORBIDDEN'|'CONFLICT'|'NOT_FOUND'='FORBIDDEN'):never{
  throw new ApplicationError({category,code,message:'Governed commercial operation denied or requires review.'});
}
export const ID=/^[A-Za-z0-9_:-]{6,100}$/;
const ACTION_PAYLOAD:Record<GovernedTool,readonly string[]>={
 ORDER_STATUS:['orderId'],
 ORDER_DRAFT:['customerId','expectedCatalogVersion','lines','fulfillment','promotionCode'],
 ORDER_CONFIRM:['orderId','expectedVersion','confirmation'],
 PAYMENT_CREATE:['orderId','method','providerId','payerEmail','cashTenderedMinor'],
 PRODUCTION_RELEASE:['orderId'],
 RECOVERY_PREPARE:['candidateId'],
};
function object(v:unknown):v is Record<string,unknown>{
 return v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
}
export function strict(v:unknown,keys:readonly string[],code='AUTONOMY_FIELDS_INVALID'):asserts v is Record<string,unknown>{
 if(!object(v)||Object.keys(v).some(k=>!keys.includes(k)||k==='__proto__'||k==='constructor'||k==='prototype'))
  deny(code,'VALIDATION');
}
function canonical(value:unknown,depth=0):string{
 if(depth>12)deny('AUTONOMY_PAYLOAD_DEPTH_INVALID','VALIDATION');
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 if(!object(value))deny('AUTONOMY_PAYLOAD_INVALID','VALIDATION');
 if(Object.keys(value).some(k=>['__proto__','constructor','prototype'].includes(k)))
  deny('AUTONOMY_PAYLOAD_INVALID','VALIDATION');
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
export function hashRequest(scope:{tenantId:string;unitId:string},command:ToolRequest):string{
 return createHash('sha256').update(canonical({tenantId:scope.tenantId,unitId:scope.unitId,
   tool:command.tool,key:command.idempotencyKey,payload:command.payload})).digest('hex');
}
export function receiptId(scope:{tenantId:string;unitId:string},key:string):string{
 return createHash('sha256').update(canonical({...scope,key})).digest('hex');
}
export function validateToolRequest(value:unknown):ToolRequest{
 strict(value,['tool','idempotencyKey','payload','approvalId'],'AUTONOMY_COMMAND_INVALID');
 const tool=value.tool;
 if(typeof tool!=='string'||!(GOVERNED_TOOLS as readonly string[]).includes(tool))
  deny('AUTONOMY_TOOL_NOT_ALLOWLISTED');
 if(typeof value.idempotencyKey!=='string'||!ID.test(value.idempotencyKey))
  deny('AUTONOMY_IDEMPOTENCY_INVALID','VALIDATION');
 if(value.approvalId!==undefined&&
   (typeof value.approvalId!=='string'||!ID.test(value.approvalId)))
  deny('AUTONOMY_APPROVAL_ID_INVALID','VALIDATION');
 strict(value.payload,ACTION_PAYLOAD[tool as GovernedTool],'AUTONOMY_TOOL_PAYLOAD_INVALID');
 if(canonical(value.payload).length>20000)deny('AUTONOMY_PAYLOAD_TOO_LARGE','VALIDATION');
 const p=value.payload;
 if(['ORDER_STATUS','ORDER_CONFIRM','PAYMENT_CREATE','PRODUCTION_RELEASE'].includes(tool)&&
    (typeof p.orderId!=='string'||!ID.test(p.orderId)))deny('AUTONOMY_ORDER_ID_INVALID','VALIDATION');
 if(tool==='RECOVERY_PREPARE'&&(typeof p.candidateId!=='string'||!ID.test(p.candidateId)))
  deny('AUTONOMY_CANDIDATE_ID_INVALID','VALIDATION');
 if(tool==='ORDER_DRAFT'&&(typeof p.customerId!=='string'||!ID.test(p.customerId)))
  deny('AUTONOMY_CUSTOMER_ID_INVALID','VALIDATION');
 if(tool==='ORDER_CONFIRM'&&(!Number.isSafeInteger(p.expectedVersion)||
    !object(p.confirmation)||Object.keys(p.confirmation).some(k=>!['kind','evidenceRef','totalMinor'].includes(k))||
    p.confirmation.kind!=='CUSTOMER_MESSAGE'||typeof p.confirmation.evidenceRef!=='string'||
    !/^conversation:[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(p.confirmation.evidenceRef)||
    !Number.isSafeInteger(p.confirmation.totalMinor)||Number(p.confirmation.totalMinor)<=0))
  deny('AUTONOMY_CONFIRMATION_INVALID','VALIDATION');
 if(tool==='PAYMENT_CREATE'&&
   !['PIX','PAYMENT_LINK','CHECKOUT','PIX_MANUAL','CARD_ON_DELIVERY','CASH_ON_DELIVERY'].includes(String(p.method)))
  deny('AUTONOMY_PAYMENT_METHOD_INVALID','VALIDATION');
 return value as unknown as ToolRequest;
}
export function validatePolicy(ctx:TenantContext,unitId:string,value:unknown,
  now:string):AutonomyPolicy{
 requireBusinessAdmin(ctx);
 const scope=requireBusinessScope(ctx,unitId);
 strict(value,['expectedVersion','mode','allowedTools','maxOrderMinor','maxPaymentMinor']);
 const v=value as unknown as PublishAutonomyPolicy;
 if(!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<0||
   !['ASSIST','COPILOT','AUTONOMOUS_GOVERNED'].includes(v.mode)||
   !Array.isArray(v.allowedTools)||v.allowedTools.length>GOVERNED_TOOLS.length||
   new Set(v.allowedTools).size!==v.allowedTools.length||
   v.allowedTools.some(x=>!(GOVERNED_TOOLS as readonly string[]).includes(x))||
   !Number.isSafeInteger(v.maxOrderMinor)||v.maxOrderMinor<0||v.maxOrderMinor>100_000_000||
   !Number.isSafeInteger(v.maxPaymentMinor)||v.maxPaymentMinor<0||
   v.maxPaymentMinor>v.maxOrderMinor)
  deny('AUTONOMY_POLICY_INVALID','VALIDATION');
 return {...scope,version:v.expectedVersion+1,mode:v.mode,
   allowedTools:v.allowedTools,maxOrderMinor:v.maxOrderMinor,
   maxPaymentMinor:v.maxPaymentMinor,updatedAt:now,updatedBy:ctx.userId!};
}
