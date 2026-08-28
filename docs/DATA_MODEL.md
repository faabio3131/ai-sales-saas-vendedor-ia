# MODELO DE DADOS CANÔNICO — AI SALES SAAS — v1.0

**Status:** PLANEJADO / CANÔNICO PARA IMPLEMENTAÇÃO. Não implica schema já implantado.

## Princípios
- toda entidade de negócio é tenant-scoped;
- IDs internos estáveis;
- `createdAt` e `updatedAt` em entidades persistidas;
- dinheiro em menor unidade monetária (`amountMinor`), nunca `float`;
- timestamps em UTC;
- provider payload bruto não é fonte de verdade do domínio;
- preços/totalizações são calculados pelo domínio;
- saídas de IA são sugestões/dados candidatos até validação;
- Repository Interfaces isolam Firestore do domínio;
- mudanças posteriores de schema exigem migração explícita.

## Entidades principais

### Tenant
Campos mínimos: `id`, `name`, `status`, `timezone`, `locale`, `currency`, `autonomyMode`, `createdAt`, `updatedAt`.

### User
`id`, `tenantId`, `authUserId`, `name`, `email`, `role`, `status`, `createdAt`, `updatedAt`.

### Customer
`id`, `tenantId`, `name`, `phone?`, `email?`, `externalIdentities`, `status`, `createdAt`, `updatedAt`.

### CustomerMemory
`id`, `tenantId`, `customerId`, `summary`, `interests`, `productIds`, `serviceIds`, `objections`, `preferences`, `lastContactAt?`, `lastFollowUpAt?`, `updatedAt`.

### Product / Service
`id`, `tenantId`, `name`, `description?`, `active`, `priceMinor?`, `currency`, `externalRef?`, `metadata?`, timestamps.

### Conversation
`id`, `tenantId`, `customerId`, `channel`, `externalConversationId?`, `status`, `handlingMode`, `lastMessageAt`, timestamps.

### Message
`id`, `tenantId`, `conversationId`, `customerId`, `direction`, `senderType`, `type`, `text?`, `mediaRef?`, `externalMessageId?`, `occurredAt`, `idempotencyKey?`.

### Lead
`id`, `tenantId`, `customerId`, `conversationId?`, `stage`, `interest?`, `purchaseIntent?`, `urgency?`, `budgetMinor?`, `objection?`, `sentiment?`, `nextAction?`, `confidence?`, timestamps.

### Opportunity
`id`, `tenantId`, `customerId`, `leadId?`, `stage`, `title?`, `estimatedValueMinor?`, `currency`, `nextAction?`, `nextActionAt?`, `lostReason?`, timestamps.

### FollowUp
`id`, `tenantId`, `customerId`, `opportunityId?`, `conversationId?`, `status`, `reason`, `scheduledAt`, `attempt`, `lastAttemptAt?`, `completedAt?`, `idempotencyKey`, timestamps.

### RecoveryCandidate / RecoveryAction
Registra entidade recuperável, motivo, evidências, estratégia aprovada, política aplicada, status e resultado.

### Quote
`id`, `tenantId`, `customerId`, `opportunityId?`, `status`, `currency`, `subtotalMinor`, `discountMinor`, `totalMinor`, `validUntil?`, timestamps.

### QuoteItem
`id`, `tenantId`, `quoteId`, `itemType`, `productId?`, `serviceId?`, `descriptionSnapshot`, `quantity`, `unitPriceMinor`, `totalMinor`.

### Cart / CartItem
Previstos para integrações futuras de checkout. Devem preservar origem externa e status de abandono/pagamento quando aplicável.

### Sale / SaleItem
Sale registra fechamento e atribuição de receita. Itens preservam snapshot histórico de descrição, quantidade e preço no momento da venda.

### Payment
`id`, `tenantId`, `saleId`, `customerId`, `provider`, `providerPaymentId?`, `method`, `status`, `amountMinor`, `currency`, `idempotencyKey`, `expiresAt?`, `confirmedAt?`, timestamps.

### AIAction
Registra `tenantId`, contexto da ação, capability, provider/model efetivo, tokens, latência, custo estimado, decisão, resultado, erro sanitizado e timestamps.

### AutomationJob
`id`, `tenantId`, `type`, `entityId`, `status`, `scheduledAt`, `attempt`, `maxAttempts?`, `correlationId`, `idempotencyKey?`, timestamps.

### RevenueEvent
`id`, `tenantId`, `customerId`, `saleId?`, `type`, `amountMinor`, `currency`, `attribution`, `sourceEntityId?`, `occurredAt`.

### Plan / Subscription
Plan define catálogo de entitlements/limites. Subscription vincula tenant ao plano, estado de assinatura, período e limites efetivos.

### Policy / TenantSettings
Configura autonomia, limites comerciais, permissões de ações automáticas, descontos máximos, thresholds de aprovação humana e comportamento do canal/IA.

### ChannelConnection
`id`, `tenantId`, `channel`, `status`, `externalAccountRef?`, `configRef?`, timestamps. Segredos não ficam como texto aberto na entidade.

## Relacionamentos principais
- Tenant 1:N Users, Customers, Products, Services, Conversations, Leads, Opportunities, Quotes, Sales, Payments, FollowUps, Jobs.
- Customer 1:1/1:N CustomerMemory conforme estratégia física; semanticamente uma memória comercial ativa por customer.
- Customer 1:N Conversations, Leads, Opportunities, Quotes, Sales.
- Conversation 1:N Messages.
- Lead N:1 Customer e opcionalmente Conversation.
- Opportunity N:1 Customer; pode derivar de Lead.
- Quote 1:N QuoteItems.
- Sale 1:N SaleItems e 1:N Payments.

## State machines

### Funnel
`NOVO → CONVERSANDO → QUALIFICADO → PROPOSTA → AGUARDANDO_CLIENTE → FECHADO`

Alternativos: `RECUPERACAO`, `PERDIDO`.

### Quote
`DRAFT → SENT → VIEWED? → ACCEPTED | REJECTED | EXPIRED | CANCELLED`

### Payment
`CREATED → PENDING → CONFIRMED | FAILED | CANCELLED | EXPIRED | REFUNDED`

### FollowUp / Job
`SCHEDULED → PROCESSING → COMPLETED | RETRY | FAILED | CANCELLED`

### Conversation handling
Estados devem diferenciar atendimento IA, humano e handoff sem perder histórico.

## Unicidade e deduplicação
- identities externas devem ser únicas dentro do tenant/canal quando aplicável;
- `externalMessageId` + tenant/channel deve suportar deduplicação;
- `providerPaymentId` deve ser único por provider/tenant quando aplicável;
- `idempotencyKey` obrigatória em pagamentos e envios críticos;
- webhook event IDs devem impedir processamento duplicado.

## Query patterns prioritários
- conversas ativas por tenant/channel/externalConversationId;
- mensagens recentes por conversation e occurredAt;
- lead ativo por customer;
- oportunidades por tenant/stage/nextActionAt;
- follow-ups por tenant/status/scheduledAt;
- payments por tenant/provider/providerPaymentId;
- jobs por status/scheduledAt;
- revenue events por tenant/occurredAt/attribution.

Firestore pode exigir índices compostos correspondentes a esses padrões; índices físicos são detalhe de infraestrutura e devem ser documentados quando implementados.

## Invariantes de segurança
Nenhum repository executa leitura/escrita de entidade de negócio sem tenant scope validado. IDs externos nunca substituem autorização. Provider raw payload, se armazenado, deve ser minimizado/restrito e nunca exposto diretamente ao frontend.
