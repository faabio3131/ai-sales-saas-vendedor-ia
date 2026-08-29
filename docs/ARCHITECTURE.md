# ARQUITETURA OFICIAL — AI SALES SAAS — v1.0

**Status:** CANÔNICA PARA CONSTRUÇÃO — cópia operacional do repositório.

## Missão
Construir um vendedor/assistente comercial de IA simples para pequenas e médias empresas, focado em atendimento, acompanhamento, recuperação, conversão e receita.

## Princípios
- simplicidade extrema na experiência;
- complexidade escondida no backend;
- resultado financeiro antes de tecnologia;
- Mobile First e PWA;
- multiempresa desde a origem;
- independência de fornecedores;
- construção incremental, testada e versionada.

## Arquitetura macro
`Cliente → WhatsApp/Web → Channel Layer → Conversation Engine → Lead Intelligence → Sales Engine → Follow-up/Recovery/Upsell → Quote/Cart → Payment Engine → Sale Closed → Revenue Attribution`

IA transversal:
`Application/Domain → AI Service → Universal AI Provider Interface → AI Router → Provider Adapter`

Infraestrutura:
`GitHub → CI/Validation → Cloud Deployment → Auth / Database / Backend / Observability`

## Camadas
1. Presentation — Web/PWA responsiva.
2. Application — casos de uso e orquestração.
3. Domain — regras comerciais e entidades.
4. AI — interface universal, router, adapters e normalização.
5. Automation — eventos, jobs, timers e follow-ups.
6. Integration — WhatsApp, pagamentos, canais e APIs.
7. Infrastructure — banco, auth, secrets, logs, deploy e monitoramento.

## Multitenancy
Toda entidade de negócio deve ser associada ao tenant. Isolamento por `tenantId` é obrigatório e bloqueador de release.

Entidades principais: Tenant, User, Customer, CustomerMemory, Product, Service, Conversation, Message, Lead, Opportunity, Quote, Cart, Sale, Payment, FollowUp, AIAction, AutomationJob, RevenueEvent, Subscription, Plan.

## CRM invisível e Conversation Engine
Conversas devem gerar automaticamente, quando possível, Customer, Lead, interesse, intenção, estágio e próxima ação. Separar histórico bruto (`Conversation History`) de memória comercial resumida (`Customer Commercial Memory`).

## Lead Intelligence
Extrair dados estruturados como nome, interesse, produtos/serviços, intenção, urgência, orçamento, objeção, sentimento e próxima ação. Saídas de IA devem ser validadas antes de alterar o domínio.

## Sales Engine
Coração comercial. Responsável por identificar oportunidade, classificar cliente, acompanhar negociação, acionar follow-up, recuperação, upsell, proposta, pagamento e fechamento.

Funil inicial:
`NOVO → CONVERSANDO → QUALIFICADO → PROPOSTA → AGUARDANDO_CLIENTE → FECHADO`

Estados adicionais: `RECUPERACAO`, `PERDIDO`.

## Follow-up e Recovery
Follow-up deve ser contextual por tempo, estágio, intenção e política. Sales Recovery cobre leads abandonados, propostas sem resposta, negociações interrompidas e reativação.

## Cart Recovery / Upsell / Cross-sell
Cart Recovery entra quando houver integração de checkout. Upsell/cross-sell somente com catálogo e regras reais do tenant. IA nunca inventa produto, preço ou condição.

## Quote / Proposal
Coleta dados, aplica regras do domínio, gera proposta e prepara aceite/pagamento. Totais são calculados pelo domínio, não pela IA.

## Payment Engine
`Business Domain → PaymentService → PaymentProviderInterface → Adapter`

Operações previstas: `createPix`, `createPaymentLink`, `createCheckout`, `getPaymentStatus`, `cancelPayment`, `refundPayment`, `validateWebhook`.

Pagamento confirmado somente por backend/webhook validado. Idempotência obrigatória.

## Universal AI Provider Interface
Nenhum módulo comercial chama Gemini/OpenAI/Anthropic diretamente.

`Business/Application → AI Service → Universal AI Provider Interface → AI Router → GeminiAdapter/OpenAIAdapter/AnthropicAdapter/FutureAdapter`

Capabilities: `FAST_CHAT`, `LEAD_CLASSIFICATION`, `DATA_EXTRACTION`, `GENERAL_REASONING`, `ADVANCED_REASONING`, `VISION`, `AUDIO`, `TOOL_USE`.

Resposta normalizada inclui conteúdo, dados estruturados, tool calls, provider, model, tokens, latência, custo estimado, finish reason e erro.

## Autonomy / Policy Engine
Níveis: `ASSIST`, `COPILOT`, `AUTONOMOUS`.

Toda ação sensível passa pelo Policy Engine. Plano comercial e nível de autonomia são dimensões separadas.

## Feature Entitlements
`FeatureEntitlementService` centraliza habilitação e limites de recursos por plano. Proibido espalhar lógica de plano pelo código.

## Channel Architecture
`Business Domain → ChannelService → ChannelInterface → Adapter`

Primeiro adapter: WhatsApp. Futuro: Instagram, WebChat e outros.

## Event System
Eventos iniciais: CustomerCreated, LeadCreated, LeadQualified, QuoteCreated, QuoteSent, FollowUpDue, CartAbandoned, PaymentCreated, PaymentConfirmed, SaleWon, SaleLost, UpsellAccepted.

## Automation / Job Engine
Follow-up, recovery, carrinho, lembretes e reanálises devem funcionar sem tela aberta. V1 pragmática, sem infraestrutura distribuída desnecessária.

## Revenue Attribution
Classificações: `ORGANIC`, `AI_ASSISTED`, `AI_RECOVERED`, `CART_RECOVERED`, `UPSELL`, `CROSS_SELL`.

North Star: **receita influenciada ou recuperada pelo sistema**.

## Persistência
Firestore é candidato inicial por velocidade, porém o domínio depende de Repository Interfaces, não da API do Firestore.

## Backend
Node.js server-side para regras, IA, webhooks, integrações, secrets, pagamentos, jobs e segurança.

## Segurança
Authentication, Authorization, Tenant Isolation, Secret Management, Webhook Validation, Rate Limiting quando aplicável, Input Validation, Audit Log, Error Sanitization e Idempotency.

## Observabilidade e falhas
Monitorar erros, latência, custo de IA, integrações, webhooks, jobs, conversão e receita. Falha de IA não derruba app; falha de canal não apaga mensagem; falha de pagamento não fecha venda; jobs admitem retry seguro.

## Estrutura lógica prevista
```text
/src
  /app
  /domain
  /ai
  /channels
  /payments
  /automation
  /policies
  /subscriptions
  /analytics
  /auth
  /tenancy
  /repositories
  /infrastructure
  /api
  /ui
/tests
```

## Fases
- MVP 0: conta, empresa, clientes, catálogo, conversa, IA, lead automático, pipeline, follow-up, dashboard.
- MVP 1: WhatsApp, memória comercial, Sales Recovery, onboarding, planos, políticas, logs, segurança, métricas.
- MVP 2: billing, pagamentos/Pix, orçamento, upsell, cross-sell, Revenue Attribution.

## Regra final
GitHub e a documentação canônica do projeto são a autoridade durável de código e arquitetura. Ambientes externos do ecossistema Google podem ser usados futuramente para publicação, deploy ou infraestrutura quando aprovados, mas não possuem autoridade para alterar arquitetura, código ou escopo autonomamente. O produto deve sobreviver à substituição de qualquer provedor de IA, Firebase, provedor de pagamento, canal ou plataforma de deploy por meio de interfaces/adapters.
