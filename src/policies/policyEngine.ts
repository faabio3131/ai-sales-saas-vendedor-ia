import { createErrorResult } from '../infrastructure/errors';
import { Result } from '../types/contracts';
import { PolicyDecision, PolicyEngineInterface, PolicyEvaluationInput, SalesAction } from '../sales/contracts';

const HUMAN_ONLY_ACTIONS: readonly SalesAction[] = ['CREATE_PAYMENT'];
const COPILOT_AUTO_ACTIONS: readonly SalesAction[] = ['RESPOND','QUALIFY','FOLLOW_UP','NO_ACTION'];

export class PolicyEngine implements PolicyEngineInterface {
  async evaluate(input: PolicyEvaluationInput): Promise<Result<PolicyDecision>> {
    if (!input.tenantId?.trim()) return createErrorResult('VALIDATION', 'POLICY_TENANT_REQUIRED', 'Tenant is required.', false);

    if (HUMAN_ONLY_ACTIONS.includes(input.action)) {
      // A generic AI sales decision has no verified order ID/total. It cannot
      // authorize financial execution. Only OrderPaymentPolicyEngine checks a
      // confirmed, persisted order and authenticated operator for CREATE_PAYMENT.
      return { ok: true, data: { allowed: false, requiresHumanApproval: true,
        reasonCode: 'CONFIRMED_ORDER_REQUIRED', effectiveLimits: {} } };
    }

    if (input.autonomyMode === 'ASSIST') {
      return { ok: true, data: { allowed: true, requiresHumanApproval: input.action !== 'NO_ACTION', reasonCode: input.action === 'NO_ACTION' ? 'NO_ACTION_SAFE' : 'ASSIST_MODE_REQUIRES_APPROVAL', effectiveLimits: {} } };
    }

    if (input.autonomyMode === 'COPILOT') {
      const autoAllowed = COPILOT_AUTO_ACTIONS.includes(input.action);
      return { ok: true, data: { allowed: true, requiresHumanApproval: !autoAllowed, reasonCode: autoAllowed ? 'COPILOT_SAFE_ACTION' : 'COPILOT_SENSITIVE_ACTION', effectiveLimits: {} } };
    }

    if (input.autonomyMode === 'AUTONOMOUS_GOVERNED') {
      // Recommendations are not execution grants. The T07 Tool Gateway
      // enforces trusted evidence, scoped policy and durable human approval.
      const safe = ['RESPOND','QUALIFY','FOLLOW_UP','NO_ACTION'].includes(input.action);
      return { ok: true, data: { allowed: true, requiresHumanApproval: !safe,
        reasonCode: safe ? 'GOVERNED_COMMERCIAL_ADVICE' : 'GOVERNED_TOOL_GATEWAY_REQUIRED',
        effectiveLimits: {} } };
    }
    if (input.autonomyMode === 'AUTONOMOUS') {
      return { ok: true, data: { allowed: false, requiresHumanApproval: true,
        reasonCode: 'LEGACY_AUTONOMY_DISABLED', effectiveLimits: {} } };
    }

    return createErrorResult('VALIDATION', 'AUTONOMY_MODE_INVALID', 'Autonomy mode is invalid.', false);
  }
}
