
/** Deterministic fail-closed risk screening for trusted customer messages.
 * AI output or client-supplied riskFlags cannot clear these escalations. */
export type CommercialRisk =
 'ALLERGEN_UNVERIFIED'|'FINANCIAL_DISPUTE'|'DISCOUNT_POLICY_REVIEW'|'PROMPT_INJECTION';
export function classifyCommercialRisks(message:string):CommercialRisk[]{
 if(typeof message!=='string'||message.length>12000)return ['PROMPT_INJECTION'];
 const risks:CommercialRisk[]=[];
 if(/al[eé]rg|alergia|intoler[aâ]ncia|gl[uú]ten|lactose|amendoim|contamina[cç][aã]o cruzada/i.test(message))
  risks.push('ALLERGEN_UNVERIFIED');
 if(/estorno|chargeback|contesta[cç][aã]o|cobran[cç]a indevida|paguei (?:duas vezes|e n[aã]o)|devolu[cç][aã]o de dinheiro/i.test(message))
  risks.push('FINANCIAL_DISPUTE');
 if(/desconto|cupom (?:ilegal|especial|n[aã]o autorizado)|pre[cç]o especial|\d{1,3}\s*%\s*(?:off|de desconto)/i.test(message))
  risks.push('DISCOUNT_POLICY_REVIEW');
 if(/ignore (?:todas? )?(?:as )?instru[cç][oõ]es|system prompt|developer prompt|operation_mode|modo operacional|transfira dinheiro|simule pagamento|fing[ie] (?:ter|que)|ignore previous instructions|desative (?:as )?(?:regras|prote[cç][oõ]es)/i.test(message))
  risks.push('PROMPT_INJECTION');
 return risks;
}
