import { describe,expect,it,vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { CustomerRepository } from '../src/customers/contracts';
import type { Customer } from '../src/customers/model';
import type { Order,OrderRepository,OrderConfirmationEvidence } from '../src/orders/model';
import type { TenantContext } from '../src/types/contracts';
import type { ConversationRepository,MessageRepository } from '../src/conversations/contracts';
import type { Conversation,Message } from '../src/conversations/model';
import { OrderService } from '../src/orders/service';
import { createOrdersRouter } from '../src/orders/routes';
import { ConversationOrderConfirmationVerifier } from '../src/orders/confirmationVerifier';
import { errorHandler } from '../src/api/middleware/errorHandler';
import { catalogInput,catalogFixture,ctx,NOW,profiles,InMemoryCatalog } from './helpers/t03Fixtures';

class MemoryOrderRepository implements OrderRepository {
  readonly orders=new Map<string,Order>();
  readonly ids=new Map<string,{orderId:string;fingerprint:string}>();
  readonly seq=new Map<string,number>();
  private tail:Promise<void>=Promise.resolve();
  private scope(t:string,u:string){return JSON.stringify([t,u]);}
  private key(t:string,u:string,key:string){return JSON.stringify([t,u,key]);}
  private async locked<T>(action:()=>Promise<T>|T):Promise<T>{
    let release:()=>void=()=>{};
    const signal=new Promise<void>(r=>{release=r;});
    const prev=this.tail;
    this.tail=prev.then(()=>signal);
    await prev;
    try {return await action();}finally{release();}
  }
  async listByScope(t:string,u:string){
    return [...this.orders.values()].filter(o=>o.tenantId===t&&o.unitId===u).map(x=>structuredClone(x));
  }
  async findById(t:string,u:string,id:string){
    const x=this.orders.get(id);
    return x&&x.tenantId===t&&x.unitId===u?structuredClone(x):null;
  }
  async findByIdempotency(t:string,u:string,key:string){
    const i=this.ids.get(this.key(t,u,key));
    const order=i?await this.findById(t,u,i.orderId):null;
    return i&&order?{order,fingerprint:i.fingerprint}:null;
  }
  async createAtomic(draft:Order,key:string,fingerprint:string){
    return this.locked(async()=>{
      const id=this.key(draft.tenantId,draft.unitId,key);
      const prior=this.ids.get(id);
      if(prior){
        if(prior.fingerprint!==fingerprint)throw Object.assign(new Error('reuse'),{code:'ORDER_IDEMPOTENCY_CONFLICT'});
        const order=this.orders.get(prior.orderId)!;
        return structuredClone(order);
      }
      const seqKey=this.scope(draft.tenantId,draft.unitId);
      const num=(this.seq.get(seqKey)??0)+1;
      this.seq.set(seqKey,num);
      const order={...draft,orderNumber:num,version:1};
      this.orders.set(order.id,structuredClone(order));
      this.ids.set(id,{orderId:order.id,fingerprint});
      return structuredClone(order);
    });
  }
  async updateAtomic(after:Order,expectedVersion:number){
    return this.locked(async()=>{
      const before=this.orders.get(after.id);
      if(!before||before.tenantId!==after.tenantId||before.unitId!==after.unitId||
        before.customerId!==after.customerId||before.orderNumber!==after.orderNumber||
        before.version!==expectedVersion||after.version!==expectedVersion+1||
        before.status==='CANCELLED'||(before.status==='CONFIRMED'&&after.status!=='CANCELLED'))
        throw Object.assign(new Error('conflict'),{code:'ORDER_VERSION_CONFLICT'});
      this.orders.set(after.id,structuredClone(after));
      return structuredClone(after);
    });
  }
}
class MemoryCustomers {
  customers:Customer[]=[
    {id:'cust-a',tenantId:'pizza-a',name:'Maria',status:'ACTIVE',
      externalIdentities:[],createdAt:NOW,updatedAt:NOW},
    {id:'cust-b',tenantId:'pizza-b',name:'João',status:'ACTIVE',
      externalIdentities:[],createdAt:NOW,updatedAt:NOW},
  ];
  async findById(t:string,id:string){return this.customers.find(c=>c.tenantId===t&&c.id===id)??null;}
}
function basicDraft(overrides:Record<string,unknown>={}){
  return {
    customerId:'cust-a',idempotencyKey:'order_request_001',expectedCatalogVersion:1,
    lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',flavorIds:['marg','calab'],
      borderId:'cat',addonIds:['bacon']}],
    fulfillment:{kind:'PICKUP'},...overrides,
  };
}
async function fixture(unitId='main',tenantId='pizza-a'){
  const cat=await catalogFixture(unitId,tenantId);
  const repo=new MemoryOrderRepository();
  const customers=new MemoryCustomers();
  const confirm:OrderConfirmationEvidence={
    verify:vi.fn(async(t,c,ref,id,total)=>
      t===tenantId&&c===(tenantId==='pizza-a'?'cust-a':'cust-b')&&
      ref==='verified:'+id+':'+total),
  };
  let now=NOW;
  const service=new OrderService(repo,cat.repo,profiles,customers as unknown as CustomerRepository,
    confirm,()=>new Date(now));
  return {...cat,orders:repo,customers,confirm,service,unitId,tenantId,
    setNow:(s:string)=>{now=s;},
  };
}
describe('T03 — order lifecycle, idempotency and commercial safety',()=>{
  it('creates a complete deterministic draft and requires customer-specific approval before confirmation',async()=>{
    const {service}=await fixture();
    const order=await service.createDraft(ctx(),'main',basicDraft());
    expect(order).toMatchObject({
      tenantId:'pizza-a',unitId:'main',orderNumber:1,status:'DRAFT',
      currency:'BRL',version:1,catalogVersion:1,subtotalMinor:7900,totalMinor:7900,
      discountMinor:0,deliveryFeeMinor:0,paymentState:'NOT_REQUESTED',
      productionState:'NOT_DISPATCHED',deliveryState:'NOT_STARTED',
    });
    expect(order.customerConfirmation).toBeUndefined();
    await expect(service.confirm(ctx(),'main',order.id,{
      expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',evidenceRef:'fake',totalMinor:7900},
    })).rejects.toMatchObject({code:'ORDER_CUSTOMER_CONFIRMATION_UNVERIFIED'});
    await expect(service.confirm(ctx(),'main',order.id,{
      expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',
        evidenceRef:'verified:'+order.id+':7900',totalMinor:1},
    })).rejects.toMatchObject({code:'ORDER_TOTAL_NOT_ACKNOWLEDGED'});
    const approved=await service.confirm(ctx(),'main',order.id,{
      expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',
        evidenceRef:'verified:'+order.id+':7900',totalMinor:7900},
    });
    expect(approved).toMatchObject({status:'CONFIRMED',version:2,
      paymentState:'NOT_REQUESTED',productionState:'NOT_DISPATCHED',
      customerConfirmation:{totalMinor:7900,verifiedBy:'operator'},
    });
    await expect(service.updateDraft(ctx(),'main',order.id,{expectedVersion:2,
      expectedCatalogVersion:1,lines:basicDraft().lines,fulfillment:{kind:'PICKUP'}}))
      .rejects.toMatchObject({code:'ORDER_NOT_EDITABLE'});
    await expect(service.confirm(ctx(),'main',order.id,{
      expectedVersion:2,confirmation:{kind:'CUSTOMER_MESSAGE',
        evidenceRef:'verified:'+order.id+':7900',totalMinor:7900},
    })).rejects.toMatchObject({code:'ORDER_NOT_CONFIRMABLE'});
  });
  it('allocates monotonic unique numbers under 50 concurrent requests and deduplicates repeat calls',async()=>{
    const {service,orders}=await fixture();
    const requests=Array.from({length:50},(_,i)=>service.createDraft(ctx(),'main',
      basicDraft({idempotencyKey:'concurrent_order_'+String(i).padStart(3,'0')})));
    const created=await Promise.all(requests);
    expect(new Set(created.map(x=>x.orderNumber)).size).toBe(50);
    expect(created.map(x=>x.orderNumber).sort((a,b)=>a-b))
      .toEqual(Array.from({length:50},(_,i)=>i+1));
    const repeated=await Promise.all(Array.from({length:20},()=>service.createDraft(ctx(),'main',
      basicDraft({idempotencyKey:'concurrent_order_000'}))));
    expect(new Set(repeated.map(x=>x.id)).size).toBe(1);
    expect(orders.orders.size).toBe(50);
    await expect(service.createDraft(ctx(),'main',basicDraft({
      idempotencyKey:'concurrent_order_000',
      lines:[{catalogItemId:'drink',quantity:1}],
    }))).rejects.toMatchObject({code:'ORDER_IDEMPOTENCY_CONFLICT'});
  });
  it('makes cross-tenant and cross-unit reads, mutations and idempotency impossible',async()=>{
    const {service}=await fixture();
    const draft=await service.createDraft(ctx(),'main',basicDraft());
    await expect(service.get(ctx('pizza-b'),'main',draft.id))
      .rejects.toMatchObject({code:'ORDER_NOT_FOUND'});
    await expect(service.get(ctx(),'unit-other',draft.id))
      .rejects.toMatchObject({code:'ORDER_NOT_FOUND'});
    await expect(service.cancel(ctx('pizza-b'),'main',draft.id,{
      expectedVersion:1,reason:'Unauthorized',
    })).rejects.toMatchObject({code:'ORDER_NOT_FOUND'});
    await expect(service.createDraft(ctx('pizza-b'),'main',basicDraft()))
      .rejects.toMatchObject({code:'ORDER_CUSTOMER_NOT_FOUND'});
    await expect(service.createDraft(ctx('pizza-a','VIEWER'),'main',basicDraft()))
      .rejects.toMatchObject({code:'ORDER_OPERATOR_UNAUTHORIZED'});
    expect(await service.list(ctx(),'main')).toHaveLength(1);
    expect(await service.list(ctx('pizza-b'),'main')).toHaveLength(0);
  });
  it('supports reversible draft edits with accurate repricing and refuses stale updates',async()=>{
    const {service}=await fixture();
    const draft=await service.createDraft(ctx(),'main',basicDraft());
    const updated=await service.updateDraft(ctx(),'main',draft.id,{
      expectedVersion:1,expectedCatalogVersion:1,
      lines:[{catalogItemId:'pizza',quantity:2,sizeId:'p',flavorIds:['calab']}],
      fulfillment:{kind:'DELIVERY',zoneId:'centro',address:'Rua das Flores 120, Centro'},
    });
    expect(updated).toMatchObject({version:2,status:'DRAFT',subtotalMinor:8600,
      deliveryFeeMinor:600,totalMinor:9200,orderNumber:1});
    expect(updated.customerConfirmation).toBeUndefined();
    await expect(service.updateDraft(ctx(),'main',draft.id,{
      expectedVersion:1,expectedCatalogVersion:1,
      lines:[{catalogItemId:'drink',quantity:1}],fulfillment:{kind:'PICKUP'},
    })).rejects.toMatchObject({code:'ORDER_VERSION_CONFLICT'});
  });
  it('preserves an immutable catalog price snapshot despite later catalog price revisions',async()=>{
    const e=await fixture();
    const first=await e.service.createDraft(ctx(),'main',basicDraft());
    const oldPrice=first.totalMinor;
    await e.service.get(ctx(),'main',first.id);
    const revised=catalogInput({expectedVersion:1,
      effectiveFrom:'2026-11-22T00:00:00.000Z',
      items:catalogInput().items.map(i=>{
        if(i.id!=='pizza')return i;
        return {...i,pizza:{...i.pizza!,
          flavors:i.pizza!.flavors.map(f=>f.id==='calab'?
            {...f,pricesBySize:{...f.pricesBySize,g:9000}}:f)}};
      }),
    });
    // Changes to catalog do not mutate the original immutable order snapshot.
    const { UnitCatalogService }=await import('../src/commerce/service');
    await new UnitCatalogService(e.repo,profiles,()=>new Date(NOW)).publish(ctx(),'main',revised);
    e.setNow('2026-11-23T00:00:00.000Z');
    expect((await e.service.get(ctx(),'main',first.id)).totalMinor).toBe(oldPrice);
    await expect(e.service.confirm(ctx(),'main',first.id,{
      expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',
        evidenceRef:'verified:'+first.id+':'+oldPrice,totalMinor:oldPrice},
    })).rejects.toMatchObject({code:'ORDER_REQUOTE_REQUIRED'});
    const changed=await e.service.updateDraft(ctx(),'main',first.id,{
      expectedVersion:1,expectedCatalogVersion:2,
      lines:basicDraft().lines,fulfillment:{kind:'PICKUP'},
    });
    expect(changed.totalMinor).toBe(10900);
    expect(changed.catalogVersion).toBe(2);
    expect(changed.lines[0].flavors?.[1].priceMinor).toBe(9000);
  });
  it('supports cancellation of drafts or confirmed orders, without refund or payment events',async()=>{
    const {service}=await fixture();
    const order=await service.createDraft(ctx(),'main',basicDraft());
    const cancelled=await service.cancel(ctx(),'main',order.id,{
      expectedVersion:1,reason:'Cliente desistiu',
    });
    expect(cancelled).toMatchObject({status:'CANCELLED',version:2,
      paymentState:'NOT_REQUESTED',productionState:'NOT_DISPATCHED',
      cancellation:{actorId:'operator',reason:'Cliente desistiu'}});
    await expect(service.cancel(ctx(),'main',order.id,{
      expectedVersion:1,reason:'Duplicate retry',
    })).rejects.toMatchObject({code:'ORDER_NOT_CANCELLABLE'});
    await expect(service.confirm(ctx(),'main',order.id,{
      expectedVersion:2,confirmation:{kind:'CUSTOMER_MESSAGE',
        evidenceRef:'verified:'+order.id+':7900',totalMinor:7900},
    })).rejects.toMatchObject({code:'ORDER_NOT_CONFIRMABLE'});
    const other=await service.createDraft(ctx(),'main',
      basicDraft({idempotencyKey:'another_unique_order_1'}));
    const approved=await service.confirm(ctx(),'main',other.id,{
      expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',
        evidenceRef:'verified:'+other.id+':7900',totalMinor:7900},
    });
    const c2=await service.cancel(ctx(),'main',approved.id,{
      expectedVersion:2,reason:'Cancelamento autorizado',
    });
    expect(c2.paymentState).toBe('NOT_REQUESTED');
    expect(c2.customerConfirmation?.totalMinor).toBe(7900);
  });
  it('keeps native/integrated dispatch envelopes identical except mode and never dispatches',async()=>{
    const native=await fixture('native');
    const integrated=await fixture('integrated');
    const orderA=await native.service.createDraft(ctx(),'native',basicDraft());
    const orderB=await integrated.service.createDraft(ctx(),'integrated',basicDraft());
    await expect(native.service.dispatchIntent(ctx(),'native',orderA.id))
      .rejects.toMatchObject({code:'ORDER_NOT_CONFIRMED'});
    const confirm=async(e:typeof native,o:Order)=>e.service.confirm(ctx(),e.unitId,o.id,{
      expectedVersion:1,confirmation:{kind:'CUSTOMER_MESSAGE',
        evidenceRef:'verified:'+o.id+':'+o.totalMinor,totalMinor:o.totalMinor},
    });
    await confirm(native,orderA);await confirm(integrated,orderB);
    expect(await native.service.dispatchIntent(ctx(),'native',orderA.id))
      .toMatchObject({operationMode:'NATIVE_OPERATIONS',status:'NOT_DISPATCHED',
        dispatchEnabled:false});
    expect(await integrated.service.dispatchIntent(ctx(),'integrated',orderB.id))
      .toMatchObject({operationMode:'INTEGRATED_OPERATIONS',status:'NOT_DISPATCHED',
        dispatchEnabled:false});
  });
  it('blocks instructions smuggled through prices or approval and unknown catalog facts',async()=>{
    const {service}=await fixture();
    await expect(service.createDraft(ctx(),'main',basicDraft({
      lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',flavorIds:['unknown']}],
    }))).rejects.toMatchObject({code:'ORDER_FLAVOR_UNAVAILABLE'});
    await expect(service.createDraft(ctx(),'main',basicDraft({
      lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',flavorIds:['calab'],
        priceMinor:1}],
    }))).rejects.toMatchObject({code:'ORDER_FIELDS_INVALID'});
    await expect(service.createDraft(ctx(),'main',basicDraft({
      lines:[{catalogItemId:'drink',quantity:1}],
      discountMinor:10000000,
    }))).rejects.toMatchObject({code:'ORDER_FIELDS_INVALID'});
  });
});
describe('T03 — confirmation provenance and REST boundary',()=>{
  it('rejects AI-outbound, reused unrelated order evidence and cross-customer confirmation',async()=>{
    const message:Message={id:'msg_a',tenantId:'pizza-a',conversationId:'conv_a',
      customerId:'cust-a',direction:'OUTBOUND',senderType:'AI',type:'TEXT',
      text:'CONFIRMO PEDIDO order_111 TOTAL 7900 CENTAVOS',occurredAt:NOW};
    const conversation:Conversation={id:'conv_a',tenantId:'pizza-a',customerId:'cust-a',
      channel:'WHATSAPP',handlingMode:'AI',status:'OPEN',createdAt:NOW,updatedAt:NOW,lastMessageAt:NOW};
    const convRepo={findById:vi.fn(async(t:string,id:string)=>
      t==='pizza-a'&&id==='conv_a'?conversation:null)} as unknown as ConversationRepository;
    const msgsRepo={listByConversation:vi.fn(async()=>[message])} as unknown as MessageRepository;
    const verifier=new ConversationOrderConfirmationVerifier(convRepo,msgsRepo);
    const ref='conversation:conv_a:msg_a';
    expect(await verifier.verify('pizza-a','cust-a',ref,'order_111',7900)).toBe(false);
    message.direction='INBOUND';message.senderType='CUSTOMER';
    expect(await verifier.verify('pizza-a','cust-a',ref,'order_222',7900)).toBe(false);
    expect(await verifier.verify('pizza-a','cust-b',ref,'order_111',7900)).toBe(false);
    expect(await verifier.verify('pizza-b','cust-a',ref,'order_111',7900)).toBe(false);
    expect(await verifier.verify('pizza-a','cust-a',ref,'order_111',9000)).toBe(false);
    expect(await verifier.verify('pizza-a','cust-a',ref,'order_111',7900)).toBe(true);
  });
  it('enforces route scopes and exposes draft confirmation without charging',async()=>{
    const e=await fixture();
    const app=express();app.use(express.json());
    // Only the injected integration test context is stubbed; production uses
    // authentication + membership before the /orders router.
    app.use('/orders',(req,_res,next)=>{
      req.tenantContext=ctx(req.header('x-test-tenant')??'pizza-a',
        req.header('x-test-role')??'OWNER');
      next();
    },createOrdersRouter({orders:e.orders,catalog:e.repo,businesses:profiles,
      customers:e.customers as unknown as CustomerRepository,confirmation:e.confirm}));
    app.use(errorHandler);
    const server=app.listen(0,'127.0.0.1');
    await once(server,'listening');
    try {
      const base='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/orders/units/main';
      const bad=await fetch(base,{
        method:'POST',headers:{'content-type':'application/json','x-test-role':'VIEWER'},
        body:JSON.stringify(basicDraft()),
      });
      expect(bad.status).toBe(403);
      const created=await fetch(base,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(basicDraft()),
      });
      expect(created.status).toBe(201);
      const order=(await created.json()).data as Order;
      expect(order.status).toBe('DRAFT');
      const foreign=await fetch(base+'/'+order.id,{headers:{'x-test-tenant':'pizza-b'}});
      expect(foreign.status).toBe(404);
      const ack=await fetch(base+'/'+order.id+'/confirm',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({expectedVersion:1,confirmation:{
          kind:'CUSTOMER_MESSAGE',totalMinor:order.totalMinor,
          evidenceRef:'verified:'+order.id+':'+order.totalMinor,
        }}),
      });
      expect(ack.status).toBe(200);
      expect((await ack.json()).data).toMatchObject({
        status:'CONFIRMED',paymentState:'NOT_REQUESTED',productionState:'NOT_DISPATCHED',
      });
      const intent=await fetch(base+'/'+order.id+'/dispatch-intent');
      expect((await intent.json()).data).toMatchObject({dispatchEnabled:false});
    }finally{server.close();await once(server,'close');}
  });
});
