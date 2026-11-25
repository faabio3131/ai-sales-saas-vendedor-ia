import type { BusinessProfileInput, BusinessProfileRevision } from '../business/model';

const fields = [
  { id: 'business_name', kind: 'GENERAL', question: 'Qual o nome do estabelecimento?' },
  { id: 'contact', kind: 'CONTACT', question: 'Qual o contato do estabelecimento?' },
  { id: 'address', kind: 'CONTACT', question: 'Qual o endereço do estabelecimento?' },
  { id: 'hours', kind: 'HOURS', question: 'Qual o horário de funcionamento?' },
] as const;

export interface CompanyDraft {
  business_name: string;
  contact: string;
  address: string;
  hours: string;
  assistantName: string;
}

export function companyDraft(profile: BusinessProfileRevision): CompanyDraft {
  const answer = (id: string) => profile.facts.find(f => f.id === id)?.answer ?? '';
  return { business_name: answer('business_name'), contact: answer('contact'), address: answer('address'), hours: answer('hours'), assistantName: profile.identity.assistantName };
}

export function companyRevision(profile: BusinessProfileRevision, draft: CompanyDraft, now: string): BusinessProfileInput {
  const when = Date.parse(now);
  if (!Number.isFinite(when) || when <= Date.parse(profile.effectiveFrom) || (profile.expiresAt && when >= Date.parse(profile.expiresAt))) {
    throw new Error('Não é possível editar esta versão neste momento. Consulte a configuração vigente.');
  }
  const facts = profile.facts.map(f => ({ ...f }));
  for (const field of fields) {
    const index = facts.findIndex(f => f.id === field.id);
    const answer = draft[field.id].trim();
    if (index >= 0) {
      if (facts[index].answer !== answer) facts[index] = { ...facts[index], answer, sourceRef: 'authenticated-company-edit' };
    } else {
      facts.push({ ...field, answer, sourceRef: 'authenticated-company-edit' });
    }
  }
  return {
    expectedVersion: profile.version,
    effectiveFrom: new Date(when).toISOString(),
    ...(profile.expiresAt ? {expiresAt: profile.expiresAt} : {}),
    identity: { ...profile.identity, assistantName: draft.assistantName.trim() },
    capabilityRegistry: { ...profile.capabilityRegistry, capabilities: [...profile.capabilityRegistry.capabilities] },
    policy: { ...profile.policy },
    facts,
  };
}
