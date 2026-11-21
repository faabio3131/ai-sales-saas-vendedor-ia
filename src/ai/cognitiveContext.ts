import { createHash } from 'node:crypto';
import type { AIRequest } from './contracts';

/** Evidence originates in authorized backend repositories, never in customer text. */
export interface CommercialEvidence {
  id: string;
  tenantId: string;
  unitId?: string;
  origin: string;
  body: string;
  trusted: true;
}
export interface CommercialContext {
  unitId?: string;
  evidence: CommercialEvidence[];
}
export interface CognitiveContextPack {
  contextHash: string;
  scopeTenantId: string;
  evidenceIds: string[];
  trustedFacts: string;
  untrustedData: string;
}
const safeId = /^[a-zA-Z0-9_:-]{1,128}$/;
const INJECTION = [
  /ignore\s+(all\s+)?(previous|instructions|rules)/i,
  /ignore\s+(todas?\s+)?(as\s+)?(regras|instruções)/i,
  /\b(system|developer)\s+prompt\b/i,
  /\b(jailbreak|bypass)\b/i,
  /\b(desative|contorne|burle)\s+(a\s+)?(validação|autorização|assinatura)/i,
];
const REDACTION: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?(?:-----END [A-Z ]+-----|$)/g, '[PRIVATE_KEY]'],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{8,}/gi, '[CREDENTIAL]'],
  [/\b(?:api[_-]?key|secret|token|password|senha)\b\s*[:=]\s*[^\s,;"']{4,}/gi, '[CREDENTIAL]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[CREDENTIAL]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
  [/(?<!\d)\d{3}\.\d{3}\.\d{3}-\d{2}(?!\d)/g, '[CPF]'],
  [/(?<!\d)(?:\+?55[ -]?)?\(?\d{2}\)?[ -]?9?\d{4}[ -]?\d{4}(?!\d)/g, '[PHONE]'],
];
export function redactCommercialText(input: string): string {
  let value = input;
  for (const [regex, replacement] of REDACTION) value = value.replace(regex, replacement);
  return value;
}
/** Recursively remove credential-bearing fields before any external model or S2S call. */
function sanitizeUnknown(value:unknown,depth=0):unknown {
  if(depth>8)throw new Error('Cognitive input nesting limit.');
  if(typeof value==='string')return bounded(value,16384);
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='number') {
    if(!Number.isFinite(value))throw new Error('Invalid cognitive number.');
    return value;
  }
  if(Array.isArray(value)) {
    if(value.length>100)throw new Error('Cognitive array too large.');
    return value.map(v=>sanitizeUnknown(v,depth+1));
  }
  if(typeof value==='object') {
    if(Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)
      throw new Error('Cognitive input must be plain structured data.');
    const entries=Object.entries(value as Record<string,unknown>);
    if(entries.length>100)throw new Error('Cognitive object too large.');
    const cleaned:Record<string,unknown>={};
    for(const [key,v] of entries) {
      if(key.length>128||key==='__proto__'||key==='constructor'||key==='prototype')
        throw new Error('Invalid cognitive object key.');
      cleaned[key]=/(?:password|senha|secret|token|api[_-]?key|authorization|clientsecret|privatekey|email|phone|telefone|cpf|cnpj)/i.test(key)
        ? '[REDACTED]' : sanitizeUnknown(v,depth+1);
    }
    return cleaned;
  }
  throw new Error('Unsupported cognitive input type.');
}

export function hasInjectionMarkers(input: string): boolean {
  return INJECTION.some(pattern => pattern.test(input));
}
function bounded(input: string, length: number): string {
  if (input.length > length) throw new Error('Cognitive input exceeds boundary.');
  return redactCommercialText(input);
}
export function buildCognitiveContextPack(input: AIRequest): CognitiveContextPack {
  const tenantId = input.tenantId?.trim();
  if (!tenantId || !safeId.test(tenantId)) throw new Error('Invalid cognitive tenant scope.');
  const context = input.context as CommercialContext | undefined;
  if (context !== undefined && (
    !context || typeof context !== 'object' || Array.isArray(context) || !Array.isArray(context.evidence)
  )) throw new Error('Invalid cognitive context.');
  if (context?.unitId && !safeId.test(context.unitId)) throw new Error('Invalid cognitive unit scope.');
  const provided = context?.evidence ?? [];
  if (provided.length > 16) throw new Error('Cognitive evidence limit exceeded.');
  const seen = new Set<string>();
  const facts: Array<{id: string; text: string}> = [];
  for (const evidence of provided) {
    if (!evidence || evidence.trusted !== true || evidence.tenantId !== tenantId ||
      (context?.unitId && evidence.unitId !== context.unitId) ||
      !safeId.test(evidence.id) || seen.has(evidence.id) ||
      typeof evidence.origin !== 'string' || typeof evidence.body !== 'string') {
      throw new Error('Cognitive evidence scope invalid.');
    }
    seen.add(evidence.id);
    facts.push({id: evidence.id, text: '['+evidence.id+'] '+bounded(evidence.origin, 128)+': '+bounded(evidence.body, 1024)});
  }
  facts.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const evidenceIds = facts.map(x=>x.id);
  const trustedFacts = bounded(facts.map(x=>x.text).join('\n'), 16384);
  let serialized: string;
  try { serialized = JSON.stringify(sanitizeUnknown(input.input)); }
  catch { throw new Error('Cognitive input cannot be serialized.'); }
  if (!serialized || serialized === 'null') throw new Error('Cognitive input required.');
  const untrustedData = bounded(serialized, 32768);
  // Match the Python verifier's canonical JSON (sorted keys and compact separators).
  const canonical = JSON.stringify({evidenceIds,tenantId,trustedFacts,untrustedData});
  const contextHash = createHash('sha256').update(canonical).digest('hex');
  return { contextHash, scopeTenantId:tenantId, evidenceIds, trustedFacts, untrustedData };
}
