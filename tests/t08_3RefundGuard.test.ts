import {afterEach,describe,expect,it,vi} from 'vitest';
import {OrderPaymentService} from '../src/orderPayments/service';

afterEach(()=>vi.unstubAllEnvs());
const ctx={tenantId:'tenant_one',userId:'owner_one',role:'OWNER',requestId:'refund-guard'};
function setup(providerPaymentId?:string) {
 const payment={id:'opay_12345678',tenantId:'tenant_one',unitId:'main',orderId:'order_12345678',
  status:'CONFIRMED',version:2,amountMinor:10000,provider:'ASAAS',
  ...(providerPaymentId?{providerPaymentId}:{})};
 const store={byOrder:vi.fn(async()=>payment),transition:vi.fn(async(record:unknown)=>record)};
 const orders={findById:vi.fn(async()=>({id:'order_12345678'}))};
 const resolver={forRecordedPayment:vi.fn()};
 const service=new OrderPaymentService(store as never,orders as never,resolver as never,{} as never);
 return {service,store,resolver};
}
describe('T08.3: live PSP refunds fail closed by tenant and unit',()=>{
 it('rejects PSP refund BEFORE ledger mutation and PSP access',async()=>{
   vi.stubEnv('NODE_ENV','production');
   vi.stubEnv('ATENDEVENDE_PILOT_LIVE_ENABLED','false');
   const {service,store,resolver}=setup('psp_12345678');
   await expect(service.refund(ctx as never,'main','order_12345678',
      {expectedVersion:2,reason:'customer cancellation'}))
     .rejects.toMatchObject({code:'PILOT_FEATURE_DISABLED'});
   expect(store.transition).not.toHaveBeenCalled();
   expect(resolver.forRecordedPayment).not.toHaveBeenCalled();
 });
 it('preserves offline/manual refund pending flow',async()=>{
   vi.stubEnv('NODE_ENV','production');
   vi.stubEnv('ATENDEVENDE_PILOT_LIVE_ENABLED','false');
   const {service,store,resolver}=setup();
   const pending=await service.refund(ctx as never,'main','order_12345678',
     {expectedVersion:2,reason:'documented operator cancellation'});
   expect(pending).toMatchObject({status:'REFUND_PENDING',version:3});
   expect(store.transition).toHaveBeenCalledTimes(1);
   expect(resolver.forRecordedPayment).not.toHaveBeenCalled();
 });
});
