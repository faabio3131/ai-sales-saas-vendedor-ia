# CONTRATOS TÉCNICOS E INTERFACES — v1.0

**Status:** CANÔNICO PARA IMPLEMENTAÇÃO — cópia operacional.

## Princípios
- domínio não conhece SDKs externos;
- adapters normalizam provedores;
- interfaces pequenas, explícitas e testáveis;
- resultados e erros tipados;
- toda operação multitenant recebe `TenantContext`/`tenantId` validado;
- IA não inventa preço, produto, desconto ou permissão.

## Base
```ts
interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: string;
  requestId: string;
  correlationId?: string;
}

type AppErrorCategory =
  | 'VALIDATION' | 'AUTH' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'PROVIDER' | 'RATE_LIMIT' | 'INTERNAL';

interface Result<T> {
  ok: boolean;
  data?: T;
  error?: {
    category: AppErrorCategory;
    code: string;
    message: string;
    retryable?: boolean;
  };
}
```

## Universal AI
Capabilities:
`FAST_CHAT | LEAD_CLASSIFICATION | DATA_EXTRACTION | GENERAL_REASONING | ADVANCED_REASONING | VISION | AUDIO | TOOL_USE`

```ts
interface AIRequest {
  tenantId: string;
  capability: string;
  systemInstructions?: string;
  input: unknown;
  context?: unknown;
  responseSchema?: unknown;
  tools?: unknown[];
  temperature?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
}

interface AIResponse {
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

interface AIProviderInterface {
  generate(input: AIRequest): Promise<Result<AIResponse>>;
  supports(capability: string): boolean;
  healthCheck(): Promise<Result<unknown>>;
}

interface AIRouterInterface {
  resolveProvider(capability: string): Promise<Result<string>>;
  execute(input: AIRequest): Promise<Result<AIResponse>>;
}
```

Regra: business/application nunca chama `GeminiAdapter` diretamente.

## Lead Intelligence
Entrada contém tenant, customer, conversation, mensagens recentes, memória e catálogo relevante. Resultado estruturado pode conter `customerName`, `interest`, `productIds`, `serviceIds`, `purchaseIntent`, `urgency`, `budget`, `objection`, `sentiment`, `nextAction`, `confidence`. Validar antes de mutar o domínio.

## Sales Engine
Ações normalizadas: `RESPOND`, `QUALIFY`, `FOLLOW_UP`, `CREATE_QUOTE`, `REQUEST_HUMAN`, `RECOVER`, `OFFER_UPSELL`, `OFFER_CROSS_SELL`, `CREATE_PAYMENT`, `NO_ACTION`.

Toda decisão sensível deve informar motivo e se exige aprovação humana.

## Policy Engine
Ações governadas: `SEND_FOLLOWUP`, `CREATE_QUOTE`, `OFFER_UPSELL`, `OFFER_CROSS_SELL`, `CREATE_PAYMENT`, `NEGOTIATE`, `APPLY_DISCOUNT`, `AUTO_SEND_MESSAGE`.

Saída deve indicar `allowed`, `requiresHumanApproval`, `reasonCode`, `effectiveLimits`.

## Feature Entitlements
Features: `AI_CHAT`, `CRM_AUTO`, `FOLLOW_UP`, `SALES_RECOVERY`, `QUOTE`, `UPSELL`, `CROSS_SELL`, `CART_RECOVERY`, `PAYMENTS`, `AUTONOMOUS_SALES`, `ADVANCED_ANALYTICS`.

Contrato central: `canUse()` e `getLimits()`. Plano e autonomia são dimensões diferentes.

## Channel
Mensagens inbound/outbound devem ser normalizadas. `ChannelInterface` expõe `sendMessage`, `normalizeInbound`, `validateWebhook`. Primeiro adapter: WhatsApp.

## Payment
Dinheiro em menor unidade monetária (`amountMinor`) e moeda inicialmente BRL.

`PaymentProviderInterface`: `createPix`, `createPaymentLink`, `createCheckout`, `getPaymentStatus`, `cancelPayment`, `refundPayment`, `validateWebhook`, `normalizeWebhook`.

`PaymentConfirmed` só após validação server-side. Webhooks devem possuir event id/deduplicação.

## Repositories
Todos os repositories são tenant-scoped salvo entidade global explicitamente autorizada.

Principais contratos:
- CustomerRepository;
- ConversationRepository;
- LeadRepository;
- OpportunityRepository;
- QuoteRepository;
- PaymentRepository;
- FollowUpRepository;
- AIActionRepository.

Firestore é adapter de persistência, não contrato do domínio.

## Jobs
`JobPayload` inclui jobId, tenantId, type, entityId, scheduledAt, attempt, correlationId e metadata. Handlers devem ser idempotentes quando repetição for possível.

## Eventos
`DomainEvent` inclui eventId, eventType, tenantId, aggregateType, aggregateId, occurredAt, version, correlationId, causationId opcional e payload. Publicação via `EventPublisherInterface`.

## Quotes
Itens e totais calculados deterministicamente pelo domínio. IA pode sugerir/interpretar, nunca calcular como fonte de verdade comercial.

## API Boundary
Frontend não executa chamadas sensíveis a provedores. Backend valida sessão, tenant, input e autorização. DTO externo não é entidade de domínio. Erros são sanitizados. Operações críticas carregam request/correlation/idempotency keys quando aplicável.

## Testes de contrato obrigatórios
- resposta normalizada de IA;
- normalização de canal;
- webhook de pagamento duplicado idempotente;
- isolamento tenant em repositories;
- policy bloqueando ação não autorizada;
- entitlement bloqueando feature;
- quote determinístico sem IA.

## Mudança de contrato
Executor não altera assinatura canônica apenas para facilitar implementação. Mudanças com impacto em arquitetura, produto, segurança, custo ou escopo exigem revisão e aprovação.
