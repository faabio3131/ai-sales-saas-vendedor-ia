# BLK-080 — Leads / Opportunities — Plano de Execução

**Status:** AUTORIZADO PELO DIRETOR em 2026-08-28.

## Objetivo único
Implementar Lead Intelligence, Lead e Opportunity com pipeline comercial inicial, preservando tenant isolation e tratando saídas de IA como dados candidatos até validação.

## Escopo autorizado
- modelos `Lead` e `Opportunity` conforme `docs/DATA_MODEL.md`;
- repositories tenant-scoped e adapters Firestore;
- serviços de domínio para criação, leitura, atualização e pipeline;
- Lead Intelligence provider-neutral usando `AIRouterInterface` e capability `LEAD_CLASSIFICATION`;
- validação estrutural das saídas da IA antes de persistir;
- criação/atualização de lead a partir de customer/conversation válidos;
- criação de opportunity a partir de lead validado;
- APIs protegidas por autenticação + tenant membership;
- testes de isolamento cross-tenant, pipeline e IA normalizada;
- runtime/CI em BLK-080.

## Fora de escopo
- Sales Engine e Policy Engine (BLK-090);
- follow-up automático;
- envio de mensagens;
- quotes/payments;
- automação de mudança de estágio sem regra determinística;
- cálculo de preço/valor pela IA como fonte de verdade.

## Critério de saída
Build + typecheck + testes + runtime verdes, tenant isolation explícita e nenhuma persistência baseada em saída de IA não validada.
