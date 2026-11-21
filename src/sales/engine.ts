import { AIRouterInterface } from '../ai/contracts';
import { createErrorResult } from '../infrastructure/errors';
import { Result } from '../types/contracts';
import {
  PolicyEngineInterface,
  SALES_ACTIONS,
  SalesAction,
  SalesContext,
  SalesDecision,
  SalesEngineInterface,
} from './contracts';

function isSalesAction(value: unknown): value is SalesAction {
  return typeof value === 'string' && (SALES_ACTIONS as readonly string[]).includes(value);
}

function deterministicAction(context: SalesContext): { action: SalesAction; reason: string; confidence: number } {
  if (context.objection?.trim()) return { action: 'RESPOND', reason: 'Customer objection requires a contextual response.', confidence: 0.8 };
  switch (context.stage) {
    case 'NOVO': return { action: 'QUALIFY', reason: 'New lead requires qualification.', confidence: 0.9 };
    case 'CONVERSANDO': return { action: 'RESPOND', reason: 'Conversation is active and requires continuation.', confidence: 0.85 };
    case 'QUALIFICADO': return { action: 'CREATE_QUOTE', reason: 'Qualified lead is ready for proposal preparation.', confidence: 0.85 };
    case 'PROPOSTA': return { action: 'FOLLOW_UP', reason: 'Proposal stage requires controlled follow-up.', confidence: 0.8 };
    case 'AGUARDANDO_CLIENTE': return { action: 'FOLLOW_UP', reason: 'Customer response is pending.', confidence: 0.8 };
    case 'RECUPERACAO': return { action: 'RECOVER', reason: 'Lead is explicitly in recovery stage.', confidence: 0.9 };
    case 'FECHADO': return { action: 'NO_ACTION', reason: 'Lead is already closed.', confidence: 1 };
    case 'PERDIDO': return { action: 'NO_ACTION', reason: 'Lead is marked lost; recovery belongs to governed recovery flow.', confidence: 0.95 };
    default: return { action: 'REQUEST_HUMAN', reason: 'Unknown commercial state requires human review.', confidence: 1 };
  }
}

function validateAiSuggestion(value: unknown): { action: SalesAction; reason: string; confidence?: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isSalesAction(raw.action) || typeof raw.reason !== 'string' || !raw.reason.trim() || raw.reason.length > 500) return null;
  // A model proposal may not claim execution or assert fabricated prices or payments.
  if (/(?:R\$\s*[\d.,]+|\b\d+(?:[,.]\d+)?\s*%|\b(?:cobrei|paguei|estornei|confirmei o pagamento|enviei o pedido)\b)/i.test(raw.reason)) return null;
  const confidence = raw.confidence === undefined ? undefined : Number(raw.confidence);
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) return null;
  return { action: raw.action, reason: raw.reason.trim(), confidence };
}

export class SalesEngine implements SalesEngineInterface {
  constructor(
    private readonly policy: PolicyEngineInterface,
    private readonly ai?: AIRouterInterface,
  ) {}

  async decide(context: SalesContext): Promise<Result<SalesDecision>> {
    if (!context.tenantId?.trim()) return createErrorResult('VALIDATION', 'SALES_TENANT_REQUIRED', 'Tenant is required.', false);
    if (!context.customerId?.trim() || !context.leadId?.trim()) return createErrorResult('VALIDATION', 'SALES_CONTEXT_INVALID', 'Sales context is invalid.', false);

    let chosen = deterministicAction(context);
    let source: SalesDecision['source'] = 'DETERMINISTIC';

    if (this.ai) {
      try {
        const aiResult = await this.ai.execute({
          tenantId: context.tenantId,
          capability: 'GENERAL_REASONING',
          systemInstructions: 'Suggest only one normalized commercial next action. Never authorize yourself, invent price, discount, product, payment or permission.',
          input: {
            customerId: context.customerId,
            leadId: context.leadId,
            opportunityId: context.opportunityId,
            stage: context.stage,
            interest: context.interest,
            purchaseIntent: context.purchaseIntent,
            urgency: context.urgency,
            objection: context.objection,
            sentiment: context.sentiment,
            nextAction: context.nextAction,
          },
          responseSchema: { action: SALES_ACTIONS, reason: 'string', confidence: 'number 0..1?' },
          metadata: { source: 'BLK-090_SALES_ENGINE' },
        });
        const suggestion = aiResult.ok && aiResult.data ? validateAiSuggestion(aiResult.data.structuredData) : null;
        if (suggestion) {
          chosen = { action: suggestion.action, reason: suggestion.reason, confidence: suggestion.confidence ?? chosen.confidence };
          source = aiResult.data?.provider === 'fm-cognitive' && aiResult.data?.model === 'commercial-baseline-v1' ? 'DETERMINISTIC' : 'AI_SUGGESTED';
        }
      } catch {
        // Safe deterministic fallback. AI failure must not break the sales engine.
      }
    }

    const policyResult = await this.policy.evaluate({ tenantId: context.tenantId, action: chosen.action, autonomyMode: context.autonomyMode });
    if (!policyResult.ok || !policyResult.data) {
      return createErrorResult('INTERNAL', 'POLICY_EVALUATION_FAILED', 'Sales policy evaluation failed.', true);
    }

    return {
      ok: true,
      data: {
        action: chosen.action,
        reason: chosen.reason,
        confidence: chosen.confidence,
        source,
        allowed: policyResult.data.allowed,
        requiresHumanApproval: policyResult.data.requiresHumanApproval,
        policyReasonCode: policyResult.data.reasonCode,
      },
    };
  }
}
