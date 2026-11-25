import { describe, expect, it } from 'vitest';
import type { BusinessProfileRevision } from '../src/business/model';
import { companyDraft, companyRevision } from '../src/ui/companyProfileEditor';

const profile: BusinessProfileRevision = {
  tenantId:'tenant-test',unitId:'main',version:1,
  effectiveFrom:'2026-01-01T00:00:00.000Z',createdAt:'2026-01-01T00:00:00.000Z',createdBy:'owner',
  identity:{assistantName:'Ana',voiceStyle:'FRIENDLY'},
  capabilityRegistry:{vertical:'OTHER',capabilities:[],operationMode:'NATIVE_OPERATIONS',integrationStatus:'NOT_CONFIGURED'},
  policy:{timezone:'America/Sao_Paulo',locale:'pt-BR',memoryRetentionDays:90,personalMemoryDefault:'DENY',prohibitUnverifiedClaims:true},
  facts:[
    {id:'business_name',kind:'GENERAL',question:'Qual o nome?',answer:'Empresa teste',sourceRef:'owner-onboarding'},
    {id:'contact',kind:'CONTACT',question:'Qual o contato?',answer:'Contato teste',sourceRef:'owner-onboarding'},
    {id:'address',kind:'CONTACT',question:'Qual o endereço?',answer:'Endereço teste',sourceRef:'owner-onboarding'},
    {id:'hours',kind:'HOURS',question:'Qual o horário?',answer:'08h às 18h',sourceRef:'owner-onboarding'},
    {id:'other',kind:'FAQ',question:'Outro assunto?',answer:'Outro fato aprovado',sourceRef:'approved'},
  ],
};

describe('company profile editor',()=>{
  it('reopens the existing company information',()=>{
    expect(companyDraft(profile)).toEqual({business_name:'Empresa teste',contact:'Contato teste',address:'Endereço teste',hours:'08h às 18h',assistantName:'Ana'});
  });
  it('creates a versioned payload and preserves policies, capabilities and unrelated facts',()=>{
    const before=structuredClone(profile);
    const next=companyRevision(profile,{...companyDraft(profile),assistantName:'Ana Clara',hours:'09h às 18h'},'2026-01-02T00:00:00.000Z');
    expect(next.expectedVersion).toBe(1);
    expect(next.identity).toEqual({assistantName:'Ana Clara',voiceStyle:'FRIENDLY'});
    expect(next.policy).toEqual(profile.policy);
    expect(next.capabilityRegistry).toEqual(profile.capabilityRegistry);
    expect(next.facts.find(f=>f.id==='hours')).toMatchObject({answer:'09h às 18h',sourceRef:'authenticated-company-edit'});
    expect(next.facts.find(f=>f.id==='other')).toEqual(profile.facts[4]);
    expect(next.facts.find(f=>f.id==='contact')).toEqual(profile.facts[1]);
    expect(profile).toEqual(before);
  });
  it('refuses future or expired revisions rather than overriding them',()=>{
    expect(()=>companyRevision(profile,companyDraft(profile),profile.effectiveFrom)).toThrow();
    expect(()=>companyRevision({...profile,expiresAt:'2026-01-02T00:00:00.000Z'},companyDraft(profile),'2026-01-02T00:00:00.000Z')).toThrow();
  });
  it('preserves a future expiry on an edited profile',()=>{
    const expiring={...profile,expiresAt:'2026-01-03T00:00:00.000Z'};
    expect(companyRevision(expiring,companyDraft(expiring),'2026-01-02T00:00:00.000Z').expiresAt).toBe(expiring.expiresAt);
  });
});
