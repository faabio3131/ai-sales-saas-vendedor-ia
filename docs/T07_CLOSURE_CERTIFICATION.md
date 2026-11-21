# T07 — CERTIFICAÇÃO INTERNA FINAL — Autonomia Operacional Governada e Exceções

**Data:** 21/11/2026. **Classificação:** 100% da engenharia interna T07 certificada; NÃO se confunde com piloto real T08.  
**Autorização:** Diretor aprovou a execução da T07 em 21/11/2026 após o fechamento da T06.

## Evidências reais de certificação

- **PR:** https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/18
- **Commit funcional auditado:** `588d6ce4491cb14ea4380b8edeedb276dc364c1e`
- **CI integral do commit funcional:** https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44957683634 — **SUCCESS**
- **TypeScript:** 58 arquivos de teste, **336 testes PASS**, 0 FAIL no teste principal.
- **Python cognitivo:** **7 PASS**, 0 FAIL.
- **Smoke Docker Node:** 58 arquivos PASS; **335 PASS, 1 SKIP** por ambiente de serviço externo nos testes contidos na imagem; 0 FAIL.
- **Outros gates da CI:** build Vite/esbuild, typecheck TypeScript, controles de segurança HTTP sem autenticação, configuração do reconciliador multibanco, smoke Docker de API, smoke Docker privado cognitivo — todos concluídos com sucesso.
- **Observação:** o único SKIP no teste de imagem não é apresentado como teste executado. A ausência de integração real externa permanece gate da T08.

## Escopo efetivamente entregue

1. **Modos versionados por tenant/unidade:** `ASSIST`, `COPILOT`, `AUTONOMOUS_GOVERNED` via política escrita por OWNER/ADMIN com CAS. Sem política ativa, ASSIST com zero ferramentas; modo legado AUTONOMOUS não concede permissão.
2. **Tool Gateway com allowlist:** leitura canônica, rascunho/preço, confirmação de cliente, criação de cobrança, liberação única à cozinha e preparação de recuperação; nenhum comando para estorno, acesso financeiro administrativo, alteração de modo operacional, mudanças de preços por IA ou ativação de PDV não homologado.
3. **Aprovação humana imutável:** hash exato por comando, tenant/unidade, usuário executor, valor, prazo de até uma hora e versão de política; revogação e consumo único transacionais.
4. **Recibos auditáveis e fencing:** `RESERVED`, `COMPLETED` ou `REVIEW_REQUIRED`, com fingerprint, concorrência e chaves idempotentes por tenant/unidade. Repetição de comando confirmado (inclusive mudança posterior de estado) recupera recibo sem repetir a transação. Resultado incerto gera revisão humana, não segunda cobrança.
5. **Proveniência do WhatsApp:** contrato privado de ingresso autenticado por assinatura, vínculo cliente/tenant/unidade/telefone/mensagem, prova persistida separada do CRM; opt-in/opt-out com histórico e sinais de risco que não são apagados por confirmação posterior. A homologação do webhook oficial pertence à T08.
6. **Exceções e escalonamento:** bloqueio de alergênicos não confirmados, disputa financeira, descontos fora da política, prompt injection, consentimento ausente, falso webhook, spoof de tenant, cargo não autorizado e dados não verificados.
7. **Integração com T03/T04/T06:** jornada interna de rascunho → aceite explícito/assinado → pagamento em estado real → liberação única por modo nativo ou integrado. A confirmação de Pix vem do PSP/ledger T04 e não da IA; no integrado só existe `AWAITING_ACK` até ACK real. Notificações continuam a cargo do outbox T06 e não usam status inventado.
8. **Recuperação comercial segura:** apenas preparação de ação após opt-in assinado, sem mensagem enviada automaticamente, respeitando opt-out; papéis STAFF e CASHIER não podem iniciar recuperação.

## DoD

- [x] Jornada rotineira E2E **interna simulada** sem aprovação adicional no modo governado dentro dos limites e com confirmação confiável.
- [x] Casos de risco e exceções bloqueados/escalados.
- [x] Nenhuma elevação de privilégios, suíte cumulativa verde.
- [x] Contratos de mensagens, confirmação, pagamento, produção/notificação e recuperação com proveniência, idempotência e retries certificados internamente.
- [x] Vetores adversariais de modo operacional, fonte de pagamento, falso status, finance RBAC, alteração de preço, opt-out e spoof bloqueados.

## Evidência documental/arquitetural

- `docs/ADR-008_T07_GOVERNED_AUTONOMY.md`
- `docs/T07_AUTONOMY_RUNBOOK.md`
- `src/governance/*`, `tests/t07Governance.test.ts`, `tests/t07TrustedIngress.test.ts`, `.github/workflows/blk010-validation.yml`.

## Limites e travas externas preservados

**NÃO realizados:** cadastro/validação da proprietária da Pizzaria Americana, migração ou deploy na Contabo/Cloud Run, ativação do canal WhatsApp oficial, credenciais reais Pix/PSP, webhook homologado, conector real PDV/KDS, backups reais ou dez jornadas de piloto com clientes. Estes itens pertencem a T08.1–T08.5, sequencialmente, e exigem autorização humana específica para avançar. Nenhum teste com mock é apresentado como homologação de banco, WhatsApp ou operação em produção.

**Próximo gate:** autorização específica do Diretor para iniciar T08.1; nenhuma aprovação implícita de go-live.
