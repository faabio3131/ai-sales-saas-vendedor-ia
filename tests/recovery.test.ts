import { describe, expect, it } from 'vitest';
import { OpportunityRepository } from '../src/leads/contracts';
import { Opportunity } from '../src/leads/model';
import { PolicyEngineInterface } from '../src/sales/contracts';
import { RecoveryActionRepository, RecoveryCandidateRepository } from '../src/recovery/contracts';
import { RecoveryAction, RecoveryCandidate } from '../src/recovery/model';
import { RecoveryService } from '../src/recovery/service';

class Opportunities implements OpportunityRepository {
  constructor(public items: Opportunity[] = []) {}
  async listByTenant(t: string){ return this.items.filter(x=>x.tenantId===t); }
  async findById(t:string,id:string){ return this.items.find(x=>x.tenantId===t&&x.id===id)??null; }
  async create(x:Opportunity){ this.items.push(x); return x; }
  async update(x:Opportunity){ this.items=this.items.map(v=>v.id===x.id?x:v); return x; }
}
class Candidates implements RecoveryCandidateRepository {
  items: RecoveryCandidate[]=[];
  async listByTenant(t:string){ return this.items.filter(x=>x.tenantId===t); }
  async findById(t:string,id:string){ return this.items.find(x=>x.tenantId===t&&x.id===id)??null; }
  async findOpenByOpportunity(t:string,o:string){ return this.items.find(x=>x.tenantId===t&&x.opportunityId===o&&(x.status==='OPEN'||x.status==='ACTION_PREPARED'))??null; }
  async create(x:RecoveryCandidate){ this.items.push(x); return x; }
  async update(x:RecoveryCandidate){ this.items=this.items.map(v=>v.id===x.id?x:v); return x; }
}
class Actions implements RecoveryActionRepository {
  items: RecoveryAction[]=[];
  async listByCandidate(t:string,c:string){ return this.items.filter(x=>x.tenantId===t&&x.candidateId===c); }
  async create(x:RecoveryAction){ this.items.push(x); return x; }
}
const opp=(p:Partial<Opportunity>):Opportunity=>({id:'opp-1',tenantId:'tenant-a',customerId:'customer-a',stage:'AGUARDANDO_CLIENTE',currency:'BRL',createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z',...p});
const ctx=(tenantId='tenant-a')=>({tenantId,requestId:'req',userId:'user'});

describe('BLK-110 Sales Recovery',()=>{
  it('detects overdue opportunities and records evidence',async()=>{
    const s=new RecoveryService(new Opportunities([opp({nextAction:'Retomar proposta',nextActionAt:'2026-08-20T00:00:00.000Z'})]),new Candidates(),new Actions());
    const r=await s.detect(ctx(),new Date('2026-08-28T00:00:00.000Z'));
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({tenantId:'tenant-a',reason:'OVERDUE_NEXT_ACTION',strategy:'Retomar proposta',status:'OPEN'});
  });
  it('detects lost opportunities and ignores closed sales',async()=>{
    const s=new RecoveryService(new Opportunities([opp({id:'lost',stage:'PERDIDO',lostReason:'sem resposta'}),opp({id:'won',stage:'FECHADO'})]),new Candidates(),new Actions());
    const r=await s.detect(ctx()); expect(r).toHaveLength(1); expect(r[0].opportunityId).toBe('lost'); expect(r[0].evidence.join('|')).toContain('sem resposta');
  });
  it('does not duplicate an active candidate for the same opportunity',async()=>{
    const c=new Candidates(); const s=new RecoveryService(new Opportunities([opp({stage:'RECUPERACAO'})]),c,new Actions());
    await s.detect(ctx()); await s.detect(ctx()); expect(c.items).toHaveLength(1);
  });
  it('keeps candidates isolated by tenant',async()=>{
    const c=new Candidates(); const s=new RecoveryService(new Opportunities([opp({stage:'RECUPERACAO'}),opp({id:'opp-b',tenantId:'tenant-b',customerId:'b',stage:'PERDIDO'})]),c,new Actions());
    await s.detect(ctx('tenant-a')); await s.detect(ctx('tenant-b')); expect(await s.list(ctx('tenant-a'))).toHaveLength(1); expect((await s.list(ctx('tenant-a')))[0].tenantId).toBe('tenant-a');
  });
  it('prepares recovery through Policy Engine and defaults to human approval',async()=>{
    const c=new Candidates(); const a=new Actions(); const s=new RecoveryService(new Opportunities([opp({stage:'RECUPERACAO'})]),c,a);
    const [candidate]=await s.detect(ctx()); const action=await s.prepareAction(ctx(),candidate.id);
    expect(action).toMatchObject({requiresHumanApproval:true,status:'APPROVAL_REQUIRED',policyReasonCode:'ASSIST_MODE_REQUIRES_APPROVAL'}); expect(c.items[0].status).toBe('ACTION_PREPARED');
  });
  it('blocks cross-tenant candidate access and policy denial',async()=>{
    const c=new Candidates(); const a=new Actions(); const policy:PolicyEngineInterface={evaluate:async()=>({ok:true,data:{allowed:false,requiresHumanApproval:true,reasonCode:'BLOCKED',effectiveLimits:{}}})};
    const s=new RecoveryService(new Opportunities([opp({stage:'RECUPERACAO'})]),c,a,policy); const [candidate]=await s.detect(ctx());
    await expect(s.prepareAction(ctx('tenant-b'),candidate.id)).rejects.toMatchObject({code:'RECOVERY_CANDIDATE_NOT_FOUND'});
    await expect(s.prepareAction(ctx(),candidate.id)).rejects.toMatchObject({code:'RECOVERY_POLICY_BLOCKED'});
  });
});
