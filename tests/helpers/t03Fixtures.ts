import type { BusinessProfileRevision } from '../../src/business/model';
import type { BusinessProfileRepository } from '../../src/business/contracts';
import type { TenantContext } from '../../src/types/contracts';
import type { UnitCatalogRevision,UnitCatalogInput,UnitCatalogRepository } from '../../src/commerce/model';
import { UnitCatalogService } from '../../src/commerce/service';
export const NOW='2026-11-21T16:00:00.000Z';
export const ctx=(t='pizza-a',role='OWNER'):TenantContext=>({tenantId:t,userId:'operator',role,requestId:'r1'});
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
export const profiles={
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
export class InMemoryCatalog implements UnitCatalogRepository {
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
