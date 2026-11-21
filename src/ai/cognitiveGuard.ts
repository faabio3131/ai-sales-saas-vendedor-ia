import { SALES_ACTIONS } from '../sales/contracts';
import type { AIResponse } from './contracts';
import type { CognitiveContextPack } from './cognitiveContext';

export interface CognitiveReply {
  contractVersion: string;
  requestId: string;
  provider: string;
  model: string;
  structuredData: unknown;
  provenance: { contextHash: string; evidenceIds: string[]; origin: string };
  usage: { costMicroUsd: number; costSource: string };
}
const unsafeClaims = /\b(?:paguei|cobrei|estornei|confirmei\s+(?:o\s+)?pagamento|enviei\s+o\s+pedido|já\s+executei)\b/i;
const monetary = /(?:R\$\s*[\d.,]+|\b\d+(?:[,.]\d+)?\s*%)/i;

export function verifyCognitiveReply(
  raw: unknown, requestId: string, pack: CognitiveContextPack,
): AIResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid cognitive reply.');
  const response = raw as Partial<CognitiveReply>;
  const data = response.structuredData as Record<string, unknown> | undefined;
  if (response.contractVersion !== 'atendevende.cognitive/v1' ||
    response.requestId !== requestId || response.provider !== 'fm-cognitive' ||
    response.model !== 'commercial-baseline-v1' ||
    !response.provenance || response.provenance.contextHash !== pack.contextHash ||
    response.provenance.origin !== 'DETERMINISTIC_BASELINE' ||
    !Array.isArray(response.provenance.evidenceIds) ||
    JSON.stringify(response.provenance.evidenceIds) !== JSON.stringify(pack.evidenceIds) ||
    response.usage?.costMicroUsd !== 0 || response.usage?.costSource !== 'NO_PAID_MODEL' ||
    !data || typeof data !== 'object' || Array.isArray(data) ||
    !(SALES_ACTIONS as readonly unknown[]).includes(data.action) ||
    typeof data.reason !== 'string' || !data.reason.trim() || data.reason.length > 500 ||
    typeof data.confidence !== 'number' || !Number.isFinite(data.confidence) ||
    data.confidence < 0 || data.confidence > 1 ||
    unsafeClaims.test(data.reason) || monetary.test(data.reason)) {
    throw new Error('Cognitive output guard rejected untrusted response.');
  }
  return {
    provider: 'fm-cognitive',
    model: 'commercial-baseline-v1',
    structuredData: {
      action: data.action,
      reason: data.reason.trim(),
      confidence: data.confidence,
    },
    finishReason: 'DETERMINISTIC_BASELINE',
  };
}
