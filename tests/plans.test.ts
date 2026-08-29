import { describe, expect, it } from 'vitest';
import { FeatureEntitlementService, UsageService } from '../src/plans/service';
import { SubscriptionRepository, UsageRepository } from '../src/plans/contracts';
import { Subscription, UsageCounter } from '../src/plans/model';

class Subs implements SubscriptionRepository {
  constructor(private readonly rows: Subscription[]) {}
  async findByTenant(t:string){ return this.rows.find(x=>x.tenantId===t) ?? null; }
  async upsert(s:Subscription){ return s; }
}
class Usage implements UsageRepository {
  rows:UsageCounter[]=[];
  async find(t:string,m:string,p:string){ return this.rows.find(x=>x.tenantId===t&&x.metric===m&&x.periodKey===p) ?? null; }
  async upsert(c:UsageCounter){ this.rows=this.rows.filter(x=>x.id!==c.id); this.rows.push(c); return c; }
}
const active=(tenantId:string,planCode:'BASIC'|'STANDARD'|'PRO'|'PREMIUM',effectiveLimits?:Record<string,number>):Subscription=>({id:`s-${tenantId}`,tenantId,planCode,status:'ACTIVE',periodStart:'2020-01-01T00:00:00.000Z',periodEnd:'2099-01-01T00:00:00.000Z',effectiveLimits,createdAt:'x',updatedAt:'x'});

describe('BLK-170 Plans / Billing',()=>{
  it('separa feature entitlement do modo de autonomia',async()=>{const e=new FeatureEntitlementService(new Subs([active('t1','BASIC')]));expect(await e.canUse('t1','QUOTE')).toBe(true);expect(await e.canUse('t1','AUTONOMOUS_SALES')).toBe(false);});
  it('libera premium features apenas no plano correspondente',async()=>{const e=new FeatureEntitlementService(new Subs([active('t1','PREMIUM')]));expect(await e.canUse('t1','AUTONOMOUS_SALES')).toBe(true);expect(await e.canUse('t1','ADVANCED_ANALYTICS')).toBe(true);});
  it('falha fechado sem assinatura ativa',async()=>{const e=new FeatureEntitlementService(new Subs([]));await expect(e.canUse('t1','AI_CHAT')).rejects.toMatchObject({code:'SUBSCRIPTION_INACTIVE'});});
  it('mantém isolamento entre tenants',async()=>{const e=new FeatureEntitlementService(new Subs([active('t1','PRO')]));await expect(e.getPlan('t2')).rejects.toMatchObject({code:'SUBSCRIPTION_INACTIVE'});});
  it('aplica limites efetivos do tenant sobre o plano',async()=>{const e=new FeatureEntitlementService(new Subs([active('t1','PRO',{aiActionsPerMonth:3})]));expect((await e.getLimits('t1')).aiActionsPerMonth).toBe(3);});
  it('mede uso e bloqueia extrapolação de limite',async()=>{const e=new FeatureEntitlementService(new Subs([active('t1','PRO',{aiActionsPerMonth:2})]));const repo=new Usage();const u=new UsageService(repo,e,()=> '2026-08-29T00:00:00.000Z');expect((await u.increment('t1','aiActions','2026-08',1,'aiActionsPerMonth')).value).toBe(1);expect((await u.increment('t1','aiActions','2026-08',1,'aiActionsPerMonth')).value).toBe(2);await expect(u.increment('t1','aiActions','2026-08',1,'aiActionsPerMonth')).rejects.toMatchObject({code:'USAGE_LIMIT_EXCEEDED'});});
});
