import { describe,expect,it } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createCommerceRouter } from '../src/commerce/routes';
import { errorHandler } from '../src/api/middleware/errorHandler';
import type { BusinessProfileRevision } from '../src/business/model';
import { UnitCatalogService } from '../src/commerce/service';
import { priceOrder } from '../src/orders/pricing';
import { catalogInput,catalogFixture,ctx,NOW,InMemoryCatalog,profiles } from './helpers/t03Fixtures';
describe('T03 — unit-scoped Catalog and Food Service pricing',()=>{
  it('calculates half/half max flavor price, edges, addons, drinks, combos, coupon and delivery in cents',async()=>{
    const {catalog}=await catalogFixture();
    const order=priceOrder(catalog,{
      lines:[
        {catalogItemId:'pizza',quantity:2,sizeId:'g',
          flavorIds:['marg','calab'],borderId:'cat',addonIds:['bacon']},
        {catalogItemId:'drink',quantity:1,variantId:'l'},
        {catalogItemId:'combo',quantity:1},
      ],
      fulfillment:{kind:'DELIVERY',zoneId:'centro',address:'Rua Exemplo 100, Centro'},
      promotionCode:'BEMVINDO',
    },NOW);
    expect(order.lines.map(l=>l.unitPriceMinor)).toEqual([7900,1000,5200]);
    expect(order.lines.map(l=>l.totalMinor)).toEqual([15800,1000,5200]);
    expect(order).toMatchObject({
      subtotalMinor:22000,discountMinor:800,deliveryFeeMinor:600,totalMinor:21800,
      appliedPromotion:{code:'BEMVINDO',discountMinor:800},
    });
    expect(order.lines[0].flavors?.map(x=>x.priceMinor)).toEqual([5000,6000]);
    expect(order.lines[0].halfHalfPricing).toBe('MAX_FLAVOR');
    expect(order.lines[2].comboComponents?.map(x=>x.name)).toEqual(['Refrigerante','Pão de alho']);
  });
  it('supports sizes and a deterministic ceil average on half/half pricing',async()=>{
    const {catalog}=await catalogFixture();
    catalog.items[0].pizza!.halfHalfPricing='AVERAGE_CEIL';
    const calc=priceOrder(catalog,{
      lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',
        flavorIds:['marg','calab'],borderId:'cat',addonIds:['bacon']}],
      fulfillment:{kind:'PICKUP'},
    },NOW);
    expect(calc).toMatchObject({subtotalMinor:7400,deliveryFeeMinor:0,totalMinor:7400});
    catalog.items[0].pizza!.flavors[1].pricesBySize.g=6001;
    const rounded=priceOrder(catalog,{
      lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',flavorIds:['marg','calab']}],
      fulfillment:{kind:'PICKUP'}
    },NOW);
    expect(rounded.totalMinor).toBe(5501);
    const small=priceOrder(catalog,{
      lines:[{catalogItemId:'pizza',quantity:1,sizeId:'p',flavorIds:['calab'],
        borderId:'cat',addonIds:['bacon']}],
      fulfillment:{kind:'PICKUP'},
    },NOW);
    expect(small.totalMinor).toBe(5500);
  });
  it('applies percent promotions with integer arithmetic and pickup without delivery fee',async()=>{
    const {catalog}=await catalogFixture();
    const value=priceOrder(catalog,{
      lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',flavorIds:['calab']},
        {catalogItemId:'drink',quantity:2}],
      fulfillment:{kind:'PICKUP'},promotionCode:'DEZ',
    },NOW);
    expect(value).toMatchObject({subtotalMinor:7400,discountMinor:740,
      deliveryFeeMinor:0,totalMinor:6660});
  });
  it('rejects missing/unavailable flavors, inactive zones, bogus variants, duplicate addons',async()=>{
    const {catalog}=await catalogFixture();
    const base={lines:[{catalogItemId:'pizza',quantity:1,sizeId:'g',flavorIds:['marg','calab']}],
      fulfillment:{kind:'PICKUP' as const}};
    expect(()=>priceOrder(catalog,{...base,lines:[{...base.lines[0],flavorIds:['marg','marg']}]},NOW))
      .toThrowError(/Catalog request/);
    expect(()=>priceOrder(catalog,{...base,lines:[{...base.lines[0],flavorIds:['unknown']}]},NOW))
      .toThrow();
    expect(()=>priceOrder(catalog,{...base,lines:[{...base.lines[0],addonIds:['bacon','bacon']}]},NOW))
      .toThrow();
    expect(()=>priceOrder(catalog,{...base,fulfillment:{kind:'DELIVERY',zoneId:'fora',address:'Rua de Teste 100'}},NOW))
      .toThrow();
    expect(()=>priceOrder(catalog,{...base,lines:[{catalogItemId:'drink',quantity:1,sizeId:'g'}]},NOW))
      .toThrow();
  });
  it('rejects unsafe prices, overflowing quantities, secret user prices and invalid coupons',async()=>{
    const {catalog}=await catalogFixture();
    const simple={lines:[{catalogItemId:'drink',quantity:1}],
      fulfillment:{kind:'PICKUP' as const}};
    expect(()=>priceOrder(catalog,{...simple,lines:[{catalogItemId:'drink',quantity:51}]},NOW)).toThrow();
    expect(()=>priceOrder(catalog,{...simple,lines:[{catalogItemId:'drink',quantity:1,unitPriceMinor:1} as never]},NOW)).toThrow();
    expect(()=>priceOrder(catalog,{...simple,promotionCode:'FAKE'},NOW)).toThrow();
    expect(()=>priceOrder(catalog,{...simple,fulfillment:{kind:'DELIVERY',zoneId:'centro',
      address:'A'}},NOW)).toThrow();
    expect(()=>priceOrder(catalog,{...simple,lines:[{catalogItemId:'combo',quantity:0}]},NOW)).toThrow();
  });
  it('enforces version, effective date, privileged edits, duplicate IDs and contract integrity',async()=>{
    const {service,repo}=await catalogFixture();
    await expect(service.publish(ctx(),'main',catalogInput({expectedVersion:0})))
      .rejects.toMatchObject({code:'COMMERCE_VERSION_CONFLICT'});
    await expect(service.publish(ctx('pizza-a','VIEWER'),'main',
      catalogInput({expectedVersion:1,effectiveFrom:'2026-11-22T00:00:00.000Z'})))
      .rejects.toMatchObject({code:'BUSINESS_MANAGEMENT_DENIED'});
    await expect(service.publish(ctx(),'main',
      catalogInput({expectedVersion:1,effectiveFrom:'2026-11-19T00:00:00.000Z'})))
      .rejects.toMatchObject({code:'COMMERCE_EFFECTIVE_PERIOD_INVALID'});
    await expect(service.publish(ctx(),'main',
      catalogInput({expectedVersion:1,effectiveFrom:'2026-11-22T00:00:00.000Z',
        items:[catalogInput().items[0],catalogInput().items[0]]})))
      .rejects.toMatchObject({code:'COMMERCE_DUPLICATE_ID'});
    await service.publish(ctx(),'main',catalogInput({expectedVersion:1,
      effectiveFrom:'2026-11-22T00:00:00.000Z',
      items:catalogInput().items.map(i=>({...i,name:i.name+' V2'}))}));
    expect((await repo.effective('pizza-a','main',NOW))?.version).toBe(1);
    expect((await repo.effective('pizza-a','main','2026-11-23T00:00:00.000Z'))?.version).toBe(2);
    expect((await repo.latest('pizza-a','main'))?.version).toBe(2);
  });
  it('keeps expired revision fail-closed and never falls back to stale prices',async()=>{
    const {service,repo}=await catalogFixture();
    await service.publish(ctx(),'main',catalogInput({expectedVersion:1,
      effectiveFrom:'2026-11-22T00:00:00.000Z',expiresAt:'2026-11-23T00:00:00.000Z'}));
    expect(await repo.effective('pizza-a','main','2026-11-24T00:00:00.000Z')).toBeNull();
  });
  it('permits same-named items at different unit/tenant scopes with independent catalog identities',async()=>{
    const a=await catalogFixture('unit-a','pizza-a');
    const b=await catalogFixture('unit-b','pizza-b');
    expect((await a.repo.effective('pizza-b','unit-a',NOW))).toBeNull();
    expect((await b.repo.effective('pizza-a','unit-b',NOW))).toBeNull();
  });
  it('serves authenticated scoped catalog revisions with fail-closed HTTP roles and version conflicts',async()=>{
    const repo=new InMemoryCatalog();
    const app=express();app.use(express.json());
    // Test-only approved identity; real API mounts authentication + membership.
    app.use('/commerce',(req,_res,next)=>{
      req.tenantContext=ctx(req.header('x-test-tenant')??'pizza-a',
        req.header('x-test-role')??'OWNER');
      next();
    },createCommerceRouter(repo,profiles));
    app.use(errorHandler);
    const server=app.listen(0,'127.0.0.1');
    await once(server,'listening');
    try{
      const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/commerce/units/main/catalog';
      const viewer=await fetch(url+'/revisions',{method:'POST',
        headers:{'content-type':'application/json','x-test-role':'VIEWER'},
        body:JSON.stringify(catalogInput())});
      expect(viewer.status).toBe(403);
      const created=await fetch(url+'/revisions',{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify(catalogInput())});
      expect(created.status).toBe(201);
      expect((await created.json()).data).toMatchObject({version:1,unitId:'main'});
      const active=await fetch(url);
      expect((await active.json()).data).toMatchObject({currency:'BRL',version:1});
      const otherTenant=await fetch(url,{headers:{'x-test-tenant':'pizza-b'}});
      expect((await otherTenant.json()).data).toBeNull();
      const duplicate=await fetch(url+'/revisions',{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify(catalogInput())});
      expect(duplicate.status).toBe(409);
      expect((await duplicate.json()).error.code).toBe('COMMERCE_VERSION_CONFLICT');
    }finally{server.close();await once(server,'close');}
  });
  it('enforces food capability before allowing pizza catalog but permits horizontal products',async()=>{
    const p={...profiles,effective:async(t:string,u:string)=>({
      tenantId:t,unitId:u,version:1,capabilityRegistry:{
        vertical:'RETAIL',capabilities:['ORDERING'],
        operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED',
      },
    } as BusinessProfileRevision)};
    const s=new UnitCatalogService(new InMemoryCatalog(),p,()=>new Date(NOW));
    await expect(s.publish(ctx(),'main',catalogInput())).rejects.toMatchObject({
      code:'COMMERCE_FOOD_CAPABILITY_REQUIRED',
    });
    await expect(s.publish(ctx(),'main',catalogInput({
      items:[{id:'item',name:'Produto',kind:'ITEM',active:true,priceMinor:2000}],
      promotions:[],
    }))).resolves.toMatchObject({version:1,currency:'BRL'});
  });
});
