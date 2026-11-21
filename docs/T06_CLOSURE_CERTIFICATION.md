# T06 — CERTIFICAÇÃO INTERNA — Food Service Pack: produção, retirada e delivery dual-mode

**Data:** 21/11/2026 | **Escopo:** engenharia interna da T06 pós-T05.
**Resultado:** implementação interna validada no SHA funcional `3058161dd0a08486f3ca80d2e135d01c8d5e194a`. A aprovação para iniciar a T07 é uma decisão humana separada. A promoção para produção real e a homologação de integrações externas permanecem reservadas à T08.

## Evidência consolidada

- PR #16: https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/16
- SHA funcional com workflow de segurança atualizado: `3058161dd0a08486f3ca80d2e135d01c8d5e194a`.
- CI integral #44954585318 — **SUCCESS**: https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44954585318
- Build Vite/esbuild, typecheck estrito, testes Python cognitivos (7 PASS), suíte TypeScript (316 PASS em 56 arquivos), limites de autenticação e segurança runtime, validação de configuração do reconciliador, Docker Node e Docker Python cognitivo: **PASS** no SHA funcional.
- Dentro do build Docker Node, 315 testes PASS e 1 SKIP por dependência de serviço externo, sem falhas. Não confundir este skip explícito com homologação de integração externa.
- A CI do SHA documental posterior e eventual CI pós-merge devem ser conferidas separadamente; prova pré-merge não é prova de deploy nem CI da main.

## Entrega interna

1. Dois modos exclusivos por tenant/unidade: `NATIVE_OPERATIONS` com KDS próprio e `INTEGRATED_OPERATIONS` com contrato de adaptador PDV/KDS, sem fallback silencioso entre destinos.
2. Conexão segura entre Order Engine T03 e Payment Engine T04: confirmação comercial, escopo e comprovante de pagamento validado (ou COD habilitado) antes da liberação; releitura em transação Firestore, incluindo capability DELIVERY.
3. Release atômico e idempotente: uma operação por pedido/unidade, projeção do pedido, evento e outbox na mesma transação; concorrência simulada de 60 liberações converge em uma operação.
4. Fila KDS limitada a operações ativas; ordens concluídas não saturam a consulta de histórico. RBAC de visualização, cozinha, liberação, entrega e administração; versões CAS e isolamento por tenant/unidade.
5. Ciclo de retirada ou delivery com transições válidas, CEP de oito dígitos, múltiplas faixas sem sobreposição, zona ativa, taxa congelada do pedido e ETA configurada. Nenhuma alegação de rastreamento GPS ou previsão de trânsito real.
6. Contrato PDV/KDS `ProductionDispatchPort/v1` com readiness, correlationId, chave de idempotência estável, ACK verificável antes de QUEUED, assinatura no adapter, inbox persistida e deduplicação também de replays antigos após eventos novos.
7. Outbox com claim/lease/fencing, retries, backoff, DLQ e seleção de tarefas vencidas/leases expirados sem starvation. Falha ambígua do PDV exige revisão humana e não cria um segundo pedido nativo.
8. Notificações após commit via eventos persistidos; identidade WhatsApp exige prova em repositório confiável separado do CRM, com proveniência de webhook assinado; ausência de canal/credencial mantém fail-closed.
9. Interface KDS com ações protegidas, visualização de ACK, tratamento de falhas, edição de várias faixas de CEP e proteção contra sobrescrita de formulários não salvos durante polling.
10. Verificação runtime de que acesso não autenticado à fila operacional é rejeitado, além da suíte cumulativa de contratos e das evidências Docker.

## DoD T06

- [x] Entrega normal, retirada e endereços fora da área exercitados em testes.
- [x] Liberação única condicionada a pagamento comprovado ou modalidade COD expressamente autorizada.
- [x] Reprocessamento, replays históricos, ACK perdido e erros não criam cozinha duplicada; GPS não é inventado.
- [x] Modo nativo com KDS autenticado, estados persistidos e notificações pós-commit.
- [x] Modo integrado com payload, versão, ACK, deduplicação, sequência e ausência de conector em falha segura.
- [x] Suítes internas dos dois modos, isolamento tenant/unidade, build, typecheck, segurança e Docker aprovados no SHA funcional.

## Fronteira não homologada — T08

- Nenhum PDV/KDS de terceiro, infraestrutura Contabo, Firestore real, índice aplicado em produção, credencial bancária, webhook real de provedor, WhatsApp real, GPS, geocodificação ou comunicação efetiva com a Pizzaria Americana foi certificado por estes testes.
- O runtime padrão instala `EmptyProductionAdapterRegistry`; modo integrado somente poderá ser ativado com conector verificado no piloto, sem aceitar nome de conector como prova suficiente.
- A CI usa doubles determinísticos para integrações/concorrência e não substitui prova operacional ou ensaio concorrente em Firestore real.
- O repositório `trustedCustomerChannelIdentities` é somente-leitura nesta etapa. Provisionamento de identidade com proveniência assinada e instalação do canal pertencem à T08.
- A T07 permanece **TRAVADA** até autorização humana específica, mesmo com a T06 internamente concluída.

## Arquivos de referência

- docs/ADR-007_T06_FULFILLMENT_DUAL_MODE.md
- docs/T06_FULFILLMENT_RUNBOOK.md
- deploy/t06-fulfillment.firestore-indexes.json
- docs/CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA.md

**CI pós-merge:** não informada nesta certificação pré-merge. Após integrar, conferir a execução no SHA da main antes de qualquer ativação real.
