/**
 * Technical Contracts and Interfaces as canonicalized in docs/TECHNICAL_CONTRACTS.md.
 * These interfaces guarantee architectural portability and decoupling from external providers.
 */

export interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: string;
  requestId: string;
  correlationId?: string;
}

export type AppErrorCategory =
  | 'VALIDATION'
  | 'AUTH'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PROVIDER'
  | 'RATE_LIMIT'
  | 'INTERNAL';

export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: {
    category: AppErrorCategory;
    code: string;
    message: string;
    retryable?: boolean;
  };
}

export type AICapability =
  | 'FAST_CHAT'
  | 'LEAD_CLASSIFICATION'
  | 'DATA_EXTRACTION'
  | 'GENERAL_REASONING'
  | 'ADVANCED_REASONING'
  | 'VISION'
  | 'AUDIO'
  | 'TOOL_USE';

export interface AIRequest {
  tenantId: string;
  capability: AICapability | string;
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
  generate(input: AIRequest): Promise<Result<AIResponse>>;
  supports(capability: AICapability | string): boolean;
  healthCheck(): Promise<Result<unknown>>;
}

export interface AIRouterInterface {
  resolveProvider(capability: AICapability | string): Promise<Result<string>>;
  execute(input: AIRequest): Promise<Result<AIResponse>>;
}
