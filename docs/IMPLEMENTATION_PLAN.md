# PLANO DE IMPLEMENTAÇÃO CANÔNICO — v1.0

**Status:** roteiro oficial de construção incremental.

## Regras gerais
Cada bloco possui objetivo único, escopo autorizado, itens fora de escopo, testes e critério de saída. É proibido pular etapas sem autorização explícita.

## Sequência

### BLK-000 — Repository & Governance Foundation
Objetivo: fundação do repositório, documentação operacional, scripts base, estrutura técnica mínima, build/test e governança. **Não implementar funcionalidades comerciais.**

### BLK-010 — Application Foundation
Estrutura Web React/TypeScript, configuração de backend Node.js, organização de camadas, health check, validação base e infraestrutura mínima.

### BLK-020 — Authentication
Autenticação inicial e sessão server-side conforme tecnologia aprovada.

### BLK-030 — Tenancy
TenantContext, isolamento, autorização tenant-scoped e testes de vazamento entre tenants.

### BLK-040 — Catalog
Produtos/serviços e regras básicas de catálogo por tenant.

### BLK-050 — Customers
Customer e CustomerMemory base.

### BLK-060 — Conversations
Conversation, Message, histórico e handoff estrutural.

### BLK-070 — AI Foundation
Universal AI Provider Interface, router, resposta normalizada e primeiro adapter aprovado.

### BLK-080 — Leads / Opportunities
Lead Intelligence, Lead e Opportunity com pipeline inicial.

### BLK-090 — Sales Engine
Decisão comercial e próxima ação governada por Policy Engine.

### BLK-100 — Follow-up
Agendamento, due queries, execução idempotente e auditoria.

### BLK-110 — Sales Recovery
Detecção de oportunidades abandonadas e estratégias de recuperação dentro de políticas.

### BLK-120 — Channels / WhatsApp
Channel Interface e primeiro adapter WhatsApp aprovado.

### BLK-130 — Dashboard / Analytics
Dashboard “o que precisa da minha atenção hoje?” e métricas comerciais iniciais.

### BLK-140 — Quotes
Quote/QuoteItem, totalização determinística, envio/aceite.

### BLK-150 — Payments
PaymentService, PaymentProviderInterface, Pix/link, webhook validado/idempotente.

### BLK-160 — Revenue Expansion
Upsell, cross-sell e atribuição de receita.

### BLK-170 — Plans / Billing
Plan, Subscription, FeatureEntitlementService e medição de uso.

### BLK-180 — Hardening
Segurança, observabilidade, retries, rate limiting quando necessário, performance, testes de regressão.

### BLK-190 — Pilot
Piloto controlado com empresas reais, coleta de falhas e validação de valor.

### BLK-200 — Commercial Release
Checklist de release, billing comercial, documentação operacional, monitoramento e rollout.

## Gates obrigatórios

### Architecture Gate
Nenhum bloco pode violar `docs/ARCHITECTURE.md`, contratos ou ADRs.

### Tenant Gate
Qualquer feature multitenant exige testes explícitos de isolamento antes de avançar.

### Security Gate
Secrets, autorização, validação e erro sanitizado devem existir antes de integrar provedores reais.

### Test Gate
Nenhuma etapa avança com build/testes pertinentes quebrados.

### Documentation Gate
Mudança de contrato/arquitetura exige atualização documental/ADR antes do próximo bloco.

### Git Gate
Cada marco estável deve estar versionado no GitHub, com relatório do que foi realmente testado.

## Relatório obrigatório por bloco
O executor deve devolver:
1. arquivos criados/alterados;
2. dependências adicionadas/removidas;
3. decisões locais tomadas dentro do escopo;
4. build executado e resultado;
5. testes executados e resultado;
6. riscos/limitações/pendências;
7. confirmação de que não alterou itens fora do escopo;
8. recomendação objetiva: pronto ou não pronto para revisão.

## Regra de promoção
O executor nunca se autopromove ao próximo bloco. O próximo bloco só começa após autorização do Diretor baseada na revisão do Arquiteto/Engenheiro Sênior.
