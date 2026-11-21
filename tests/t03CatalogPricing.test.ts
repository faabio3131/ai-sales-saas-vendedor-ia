import { describe,expect,it } from 'vitest';
import type { BusinessProfileRevision } from '../src/business/model';
import type { BusinessProfileRepository } from '../src/business/contracts';
import type { TenantContext } from '../src/types/contracts';
import type { UnitCatalogRevision,UnitCatalogInput,UnitCatalogRepository } from '../src/commerce/model';
import { UnitCatalogService } from '../src/commerce/service';
import { priceOrder } from '../src/orders/pricing';

const NOW='2026-11-21T16:00:00.000Z';
const ctx=(t='pizza-a',role='OWNER'):TenantContext=>({tenantId:t,userId:'operator',role,requestId:'r1'});
export function catalogInput(overrides:Partial<UnitCatalogInput>={}):UnitCatalogInput {
  return {
    expectedVersion:0,effectiveFrom:'2026-11-20T00:00:00.000Z',
    items:[
      {id:'pizza',name:'Pizza',active:true,kind:'PIZZA',pizza:{
        sizes:[{id:'p',name:'Pequena',active:true},{id:'g',name:'Grande',active:true}],
        flavors:[
          {id:'marg',name:'Marguerita',active:true,pricesBySize:{p:3500,g:5000}},
          {id:'calab',name:'Calabresa',active:true,pricesBySize:{p:4300,g:6000}},
        ],
        borders:[{id:'cat',name:'Catupiry',active:true,pricesBySize:{p:800,g:1200}}],
        addons:[{id:'bacon',name:'Bacon',active:true,pricesBySize:{p:400,g:700}}],
        maxFlavors:2,halfHalfPricing:'MAX_FLAVOR',
      }},
      {id:'drink',name:'Refrigerante',active:true,kind:'ITEM',priceMinor:700,
        variants:[{id:'l',name:'Garrafa',priceMinor:1000,active:true}],
        addons:[{id:'ice',name:'Gelo',priceMinor:0,active:true}]},
      {id:'bread',name:'Pão de alho',active:true,kind:'ITEM',priceMinor:1400},
      {id:'combo',name:'Combo da Casa',active:true,kind:'COMBO',priceMinor:5200,
        components:[{itemId:'drink',quantity:1},{itemId:'bread',quantity:1}]},
    ],
    deliveryZones:[{id:'centro',name:'Centro',active:true,feeMinor:600},
      {id:'fora',name:'Fora de alcance',active:false,feeMinor:9900}],
    promotions:[
      {code:'BEMVINDO',active:true,startsAt:'2026-01-01T00:00:00.000Z',
        endsAt:'2030-01-01T00:00:00.000Z',kind:'FIXED',amount:800,
        minSubtotalMinor:1000,eligibleItemIds:['pizza']},
      {code:'DEZ',active:true,startsAt:'2026-01-01T00:00:00.000Z',
        endsAt:'2030-01-01T00:00:00.000Z',kind:'PERCENT_BPS',amount:1000,
        minSubtotalMinor:1000,eligibleItemIds:[]},
    ],...overrides,
  };
}
const profiles={
  async latest(){return null;},
  async effective(t:string,u:string){
    if(u==='missing')return null;
    return {
      tenantId:t,unitId:u,version:1,capabilityRegistry:{
        vertical:'FOOD_SERVICE',capabilities:['FOOD_SERVICE','ORDERING','DELIVERY','PRODUCTION'],
        operationMode:u==='integrated'?'INTEGRATED_OPERATIONS':'NATIVE_OPERATIONS',
        integrationStatus:'NOT_CONFIGURED'
      }
    } as BusinessProfileRevision;
  },
  async createRevision(){},
} as BusinessProfileRepository;
class InMemoryCatalog implements UnitCatalogRepository {
  private items=new Map<string,UnitCatalogRevision[]>();
  private key(t:string,u:string){return JSON.stringify([t,u]);}
  async latest(t:string,u:string){return structuredClone(this.items.get(this.key(t,u))?.at(-1)??null);}
  async effective(t:string,u:string,date:string){
    const versions=this.items.get(this.key(t,u))??[];
    const v=versions.filter(x=>x.effectiveFrom<=date).at(-1);
    return structuredClone(v&&(!v.expiresAt||v.expiresAt>date)?v:null);
  }
  async createRevision(rev:UnitCatalogRevision,expected:number){
    const key=this.key(rev.tenantId,rev.unitId);
    const arr=this.items.get(key)??[];
    if(arr.length!==expected)throw Object.assign(new Error('conflict'),{code:'COMMERCE_VERSION_CONFLICT'});
    this.items.set(key,[...arr,structuredClone(rev)]);
  }
}
export async function catalogFixture(unit='main',tenant='pizza-a'){
  const repo=new InMemoryCatalog();
  const service=new UnitCatalogService(repo,profiles,()=>new Date(NOW));
  const catalog=await service.publish(ctx(tenant),unit,catalogInput());
  return {repo,service,catalog};
}
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
