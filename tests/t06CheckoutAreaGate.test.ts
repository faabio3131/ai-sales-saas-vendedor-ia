import {describe,it,expect,vi} from 'vitest';
import {OrderService} from '../src/orders/service';
import type {Order,OrderRepository} from '../src/orders/model';
import type {CustomerRepository} from '../src/customers/contracts';
import {MemorySettings,config,NOW,ctx} from './helpers/t06Fixtures';
import {parseSettings} from '../src/fulfillment/policy';
import {catalogFixture,profiles} from './helpers/t03Fixtures';

function request(address='Rua das Flores 120, Centro, Praia Grande, SP CEP 11700-000'){
 return {
  customerId:'cust-a',idempotencyKey:'new_order_valid_001',
  expectedCatalogVersion:1,lines:[{catalogItemId:'drink',quantity:1}],
  fulfillment:{kind:'DELIVERY' as const,zoneId:'centro',address},
 };
}
async function setup(withSettings=true){
 const catalog=await catalogFixture();
 const settings=new MemorySettings();
 const scope={tenantId:'pizza-a',unitId:'main'};
 if(withSettings){
  await settings.publish(parseSettings(scope,config(),'operator',NOW),0);
 }
 const saved=new Map<string,Order>();
 const createAtomic=vi.fn(async(draft:Order)=>{
  const next={...draft,version:1,orderNumber:1};
  saved.set(next.id,next);return next;
 });
 const orders:OrderRepository={
  listByScope:async()=>[...saved.values()],
  findById:async(t,u,id)=>{
   const o=saved.get(id);
   return o?.tenantId===t&&o.unitId===u?o:null;
  },
  findByIdempotency:async()=>null,
  createAtomic,updateAtomic:async(next,expected)=>{
   const current=saved.get(next.id);
   if(!current||current.version!==expected)
    throw Object.assign(new Error('CAS'),{code:'ORDER_VERSION_CONFLICT'});
   saved.set(next.id,next);return next;
  },
 };
 const customers={findById:async(t:string,id:string)=>
  t==='pizza-a'&&id==='cust-a'?{id,tenantId:t,name:'Maria',status:'ACTIVE',
    externalIdentities:[],createdAt:NOW,updatedAt:NOW}:null} as CustomerRepository;
 const confirmation={verify:async()=>true};
 const service=new OrderService(orders,catalog.repo,profiles,customers,confirmation,
  ()=>new Date(NOW),settings);
 return {service,catalog,settings,orders,createAtomic,saved};
}
describe('T06 — delivery coverage gate before order acceptance and Pix creation',()=>{
 it('refuses checkout draft outside merchant CEP area before any order exists',async()=>{
  const e=await setup();
  await expect(e.service.createDraft(ctx(),'main',request(
   'Rua X 100, Praia Grande, SP CEP 11000-000',
  ))).rejects.toMatchObject({code:'FULFILLMENT_OUTSIDE_COVERAGE'});
  expect(e.createAtomic).not.toHaveBeenCalled();
  expect(e.saved.size).toBe(0);
 });
 it('refuses a delivery payment flow if there is no approved operational policy',async()=>{
  const e=await setup(false);
  await expect(e.service.createDraft(ctx(),'main',request()))
   .rejects.toMatchObject({code:'FULFILLMENT_DELIVERY_POLICY_MISSING'});
  expect(e.createAtomic).not.toHaveBeenCalled();
 });
 it('allows valid CEP and snapshots the catalog fee before payment',async()=>{
  const e=await setup();
  const draft=await e.service.createDraft(ctx(),'main',request());
  expect(draft).toMatchObject({
    status:'DRAFT',deliveryFeeMinor:600,paymentState:'NOT_REQUESTED',
    productionState:'NOT_DISPATCHED',
  });
  const confirmed=await e.service.confirm(ctx(),'main',draft.id,{
    expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',
      evidenceRef:'conversation:valid:1',totalMinor:draft.totalMinor},
  });
  expect(confirmed.status).toBe('CONFIRMED');
  expect(confirmed.paymentState).toBe('NOT_REQUESTED');
 });
 it('rejects an invalid delivery address inserted by updating a draft',async()=>{
  const e=await setup();
  const draft=await e.service.createDraft(ctx(),'main',request());
  await expect(e.service.updateDraft(ctx(),'main',draft.id,{
   expectedVersion:1,expectedCatalogVersion:1,
   lines:request().lines,fulfillment:{
     kind:'DELIVERY',zoneId:'centro',
     address:'Rua Central 100, CEP 11000-000, Santos SP',
   },
  })).rejects.toMatchObject({code:'FULFILLMENT_OUTSIDE_COVERAGE'});
  expect(e.saved.get(draft.id)?.version).toBe(1);
 });
 it('revalidates the same paid delivery service area at confirmation time',async()=>{
  const e=await setup();
  const draft=await e.service.createDraft(ctx(),'main',request());
  const next=parseSettings({tenantId:'pizza-a',unitId:'main'},{
   ...config(),expectedVersion:1,
   postalRanges:[{zoneId:'centro',fromCep:'11800000',toCep:'11899999'}],
  },'operator',NOW);
  await e.settings.publish(next,1);
  await expect(e.service.confirm(ctx(),'main',draft.id,{
    expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',
      evidenceRef:'conversation:valid:2',totalMinor:draft.totalMinor},
  })).rejects.toMatchObject({code:'FULFILLMENT_OUTSIDE_COVERAGE'});
  expect(e.saved.get(draft.id)?.status).toBe('DRAFT');
 });
 it('keeps pickup available without CEP or delivery fee',async()=>{
  const e=await setup(false);
  const draft=await e.service.createDraft(ctx(),'main',{
   ...request(),fulfillment:{kind:'PICKUP'},
  });
  expect(draft).toMatchObject({status:'DRAFT',deliveryFeeMinor:0,
   fulfillment:{kind:'PICKUP'}});
 });
});
