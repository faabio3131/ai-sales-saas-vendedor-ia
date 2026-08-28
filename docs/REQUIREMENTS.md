# REQUISITOS FUNCIONAIS E NÃO FUNCIONAIS — v1.0

**Status:** CANÔNICO PARA ESPECIFICAÇÃO E IMPLEMENTAÇÃO — cópia operacional.

## Requisitos funcionais

### Foundation / Tenant
- **RF-001** Conta e autenticação.
- **RF-002** Criação de tenant/empresa.
- **RF-003** Isolamento multitenant obrigatório.
- **RF-004** Usuários e papéis.
- **RF-005** Configuração da empresa.
- **RF-006** Catálogo de produtos/serviços.

### Customers / Conversations / CRM invisível
- **RF-010** Criação automática de Customer quando aplicável.
- **RF-011** Conversation e Message com histórico confiável.
- **RF-012** CRM invisível atualizado a partir das conversas.
- **RF-013** CustomerMemory separada do histórico bruto.
- **RF-014** Transferência entre IA e humano.

### Leads / Sales
- **RF-020** Lead automático.
- **RF-021** Extração estruturada de intenção/dados.
- **RF-022** Funil comercial com estados definidos.
- **RF-023** Opportunity vinculada ao customer/lead.
- **RF-024** Sales Engine para decisão da próxima ação.

### Follow-up / Recovery
- **RF-030** Follow-up agendado.
- **RF-031** Follow-up contextual.
- **RF-032** Recuperação de vendas/oportunidades.
- **RF-033** Reativação de clientes.
- **RF-034** Recuperação de carrinho quando houver integração.

### Revenue Expansion
- **RF-040** Upsell baseado em catálogo/regras reais.
- **RF-041** Cross-sell baseado em catálogo/regras reais.
- **RF-042** Atribuição do resultado de expansão.

### Quotes / Payments
- **RF-050** Criação de orçamento/proposta pelo domínio.
- **RF-051** Aceite/status de proposta.
- **RF-052** Pagamentos somente via PaymentService.
- **RF-053** Pix.
- **RF-054** Confirmação de pagamento somente server-side.
- **RF-055** Webhook de pagamento validado e idempotente.

### AI
- **RF-060** Universal AI Provider Interface obrigatória.
- **RF-061** Gemini pode ser primeiro adapter, sem acoplamento do domínio.
- **RF-062** Routing por capability.
- **RF-063** Resposta de IA normalizada.
- **RF-064** Falha de IA tratada sem derrubar o app.

### Autonomia / Policies
- **RF-070** ASSIST / COPILOT / AUTONOMOUS.
- **RF-071** Policy Engine antes de ações sensíveis.
- **RF-072** Limites comerciais do tenant respeitados.

### Plans / Billing
- **RF-080** BASIC / STANDARD / PRO / PREMIUM.
- **RF-081** FeatureEntitlementService centralizado.
- **RF-082** Medição de uso/limites.

### Channels / Automation
- **RF-090** Channel Interface.
- **RF-091** WhatsApp como primeiro canal.
- **RF-092** Eventos internos.
- **RF-093** Jobs para tarefas sem tela aberta.

### Results
- **RF-100** Dashboard “O que precisa da minha atenção hoje?”.
- **RF-101** Revenue Attribution.
- **RF-102** North Star: receita influenciada/recuperada.

## Requisitos não funcionais
- **RNF-001** Mobile First.
- **RNF-002** PWA responsiva.
- **RNF-003** Secrets somente server-side.
- **RNF-004** Authentication e Authorization.
- **RNF-005** Tenant Isolation — falha bloqueia release.
- **RNF-006** Validação de input e output estruturado de IA.
- **RNF-007** Idempotência em pagamentos, webhooks, eventos e envios críticos.
- **RNF-008** Auditabilidade de ações críticas.
- **RNF-009** Observabilidade de erro, latência, custo/uso de IA, integrações e conversão.
- **RNF-010** Tolerância a falhas externas.
- **RNF-011** Portabilidade via interfaces/adapters.
- **RNF-012** Testabilidade por contratos e domínio isolado.
- **RNF-013** Performance com baseline medido, não promessa arbitrária.
- **RNF-014** Escalabilidade pragmática sem arquitetura distribuída precoce.
- **RNF-015** Privacidade e minimização de dados/contexto.
- **RNF-016** Erros sanitizados.
- **RNF-017** GitHub como fonte canônica durável do código.
- **RNF-018** Construção incremental e validada por bloco.

## Fora de escopo da V1
ERP completo, contabilidade, RH, estoque avançado, produção, compras, BI empresarial amplo e mecanismos sofisticados do Super Core Extreme.

## Aceite global
Uma entrega só é aceita com implementação do escopo autorizado, testes pertinentes, ausência de regressão conhecida, preservação de tenant/security, documentação ajustada quando necessário e relatório honesto de limitações/pendências.
