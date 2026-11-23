import {ensureFirebaseAdminApp} from '../infrastructure/firebaseAdmin';
import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import type { AICapability, AIResponse } from './contracts';

/** FM Core Base style deterministic token-pricing read model, never a guessed price. */
export interface AIPriceSnapshot {
  provider: string;
  model: string;
  currency: 'USD';
  priceSnapshotId: string;
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
}
export type AICost =
  | { status:'NO_PAID_MODEL'; modelCostMicroUsd:0 }
  | { status:'ESTIMATED_CATALOG'; modelCostMicroUsd:number; priceSnapshotId:string }
  | { status:'UNKNOWN' };

export function estimateModelCost(
  provider:string, model:string, response:AIResponse|undefined,
  snapshots:readonly AIPriceSnapshot[]=[],
): AICost {
  if (provider==='fm-cognitive' && model==='commercial-baseline-v1') {
    return {status:'NO_PAID_MODEL',modelCostMicroUsd:0};
  }
  const price=snapshots.find(x=>x.provider===provider && x.model===model);
  const inTokens=response?.inputTokens, outTokens=response?.outputTokens;
  if (!price || !price.priceSnapshotId || inTokens===undefined || outTokens===undefined ||
    ![inTokens,outTokens,price.inputMicroUsdPerMillionTokens,price.outputMicroUsdPerMillionTokens]
      .every(x=>Number.isSafeInteger(x) && x>=0)) {
    return {status:'UNKNOWN'};
  }
  const micro=(
    BigInt(inTokens)*BigInt(price.inputMicroUsdPerMillionTokens)+
    BigInt(outTokens)*BigInt(price.outputMicroUsdPerMillionTokens)+999999n
  )/1000000n;
  if (micro>BigInt(Number.MAX_SAFE_INTEGER)) return {status:'UNKNOWN'};
  return {status:'ESTIMATED_CATALOG',modelCostMicroUsd:Number(micro),priceSnapshotId:price.priceSnapshotId};
}
export interface CognitiveMeteringEvent {
  tenantId: string;
  requestId: string;
  capability: AICapability;
  provider: string;
  model: string;
  outcome: 'SUCCESS'|'FAILED'|'TIMEOUT'|'SKIPPED';
  latencyMs: number;
  fallbackUsed: boolean;
  cost: AICost;
  inputTokens?: number;
  outputTokens?: number;
  occurredAt: string;
}
export interface CognitiveMeteringSink {
  record(event:CognitiveMeteringEvent):Promise<void>;
}
export class FirestoreCognitiveMeteringSink implements CognitiveMeteringSink {
  async record(event:CognitiveMeteringEvent):Promise<void> {
    ensureFirebaseAdminApp();
    // The Firestore document contains only scoped metadata and no prompts, responses or secrets.
    await getFirestore(ensureFirebaseAdminApp()).collection('cognitiveUsageEvents').doc(randomUUID()).create({
      ...event,
      cost:{...event.cost},
    });
  }
}
