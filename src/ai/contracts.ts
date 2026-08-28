import { Result } from '../types/contracts';

export const AI_CAPABILITIES = [
  'FAST_CHAT',
  'LEAD_CLASSIFICATION',
  'DATA_EXTRACTION',
  'GENERAL_REASONING',
  'ADVANCED_REASONING',
  'VISION',
  'AUDIO',
  'TOOL_USE',
] as const;

export type AICapability = (typeof AI_CAPABILITIES)[number];

export interface AIRequest {
  tenantId: string;
  capability: AICapability;
  systemInstructions?: string;
  input: unknown;
  context?: unknown;
  responseSchema?: unknown;
  tools?: unknown[];
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface AIResponse {
  content?: string;
  structuredData?: unknown;
  toolCalls?: unknown[];
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  estimatedCost?: number;
  finishReason?: string;
  error?: unknown;
}

export interface AIProviderInterface {
  readonly id: string;
  generate(input: AIRequest): Promise<Result<AIResponse>>;
  supports(capability: AICapability): boolean;
  healthCheck(): Promise<Result<unknown>>;
}

export interface AIRouterInterface {
  resolveProvider(capability: AICapability): Promise<Result<string>>;
  execute(input: AIRequest): Promise<Result<AIResponse>>;
}
