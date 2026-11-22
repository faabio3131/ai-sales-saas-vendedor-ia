# T08.4 — Certificação de engenharia interna das dez jornadas e dois modos

**Data (BRT):** 21/11/2026.  
**Pré-requisito:** T08.3 PR #23 merged `cdf19a8657c46e60c023918c5675204ce98ba89e`, CI pós-merge `#44969942528 SUCCESS`.  
**Entrega:** PR #24; código da matriz `46720031fca33bd0de1c6d282bc798194dfd6093` / CI cumulativa [#44972280781](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44972280781) — **SUCCESS**.  
**Estado da certificação:** código aprovado na CI; CI da PR no HEAD documental final e CI pós-merge devem também passar antes de fechar formalmente T08.4 e liberar T09.

## Matriz interna simulada — 10/10

| ID | Cenário | Teste | Resultado interno |
|---|---|---|---|
| J01 | Atendimento e fatos com proveniência sem improvisar preço/horário | `tests/t08_4PilotJourneys.test.ts` / J01 | PASS |
| J02 | Pedido meia-meia, adicionais, preço em centavos e confirmação cliente | J02 | PASS |
| J03 | Área de entrega por CEP, taxa, recusa fora da cobertura, retirada | J03 | PASS |
| J04 | Pix falso de teste, assinatura de webhook fake, GET PSP, replay | J04 | PASS (NÃO é QR Pix real homologado) |
| J05 | Produção somente após liquidação simulada verificada, idempotência | J05 | PASS |
| J06 | Notificações de confirmação/preparo/pronto/entrega derivadas de evento durável | J06 | PASS |
| J07 | Financeiro dia/semana/mês com origem e conciliação, não inventa lucro | J07 | PASS |
| J08 | Expiração, duplicidade, divergência, edição e cancelamento governados | J08 | PASS |
| J09 | Isolamento tenant/unidade/autorização e dados financeiros | J09 | PASS |
| J10 | IA indisponível e ACK perdido/reinício sem duplicar pedido externo | J10 | PASS |

## Matriz de dois modos — 8/8 testes de contrato

- `NATIVE_OPERATIONS`: uma só fila KDS, estados, RBAC e persistência; **zero** tickets PDV.
- `INTEGRATED_OPERATIONS`: ticket com chave única, ACK verificado, rejeição de estado não assinado, deduplicação, progresso verificado, aviso após ACK durável.
- Falha ACK, retry, reinício, DLQ e escalada humana sem fallback indevido.
- Troca de modo com operações abertas proibida. Nenhum conector real instalado por padrão.
- Sender WhatsApp oficial por unidade e conta da empresa, com política de janela real de 24h, identidade de inbound assinado, cofre e outbox com idempotência; o serviço legada só pode ser usado em testes, nunca em produção.

## Correções funcionais T08.4

1. `src/fulfillment/notifications.ts`: runtime usa serviço oficial T08.2 em vez de rota legada sem vínculo de unidade, com verificação assinada independente, escopo tenant/unidade e flags T08.3 fail-closed. Aviso de confirmação operacional inclui o número do pedido, sem alegar sucesso financeiro.
2. `src/fulfillment/policy.ts`: `ProductionStarted` gera aviso somente após mudança persistida para `IN_PREPARATION`.
3. `src/fulfillment/service.ts`: `acknowledge` gera evento/outbox de notificação apenas após ACK persistido no modo integrado, não antes da confirmação externa.
4. Testes prévios T06 adaptados ao novo comportamento cumulativo, sem remover verificações de segurança.
5. CI dedicada às dez jornadas e aos dois modos, além de teste cumulativo, Docker e Python.

## Prova e limitações

A suíte tem **67 arquivos** TypeScript e **400 testes aprovados**, além de **7 testes Python cognitivos e 8 testes Python de operações/recuperação T08.3** (conforme logs da CI de código). A imagem Docker executa novamente os testes durante build, com um SKIP de ambiente do teste S2S anterior, sem falhas. Build, typecheck, isolamento, configurações, Compose, smoke do contêiner de produção/staging e Core privativo: PASS na CI cumulativa #44972280781.

**Limites obrigatórios:** nenhum pagamento real/QR Pix de banco real, mensagem Meta real, WABA, PDV homologado, conta do restaurante real, deploy público, aprovação da proprietária, aceite das dez jornadas reais ou go-live ocorreu. A homologação **real** permanece 0/10. O aceite interno não valida operação com o provedor/contabilidade nem substitui backup/restauração GCP real. O modo escolhido pelo estabelecimento só pode operar após credenciais, prova externa e decisão humana T08.5.

**Próximo gate:** após CI de HEAD documental e pós-merge da main aprovadas, engenharia T08.4 pode ser encerrada e T09 pode começar independentemente da ativação externa T08.5. O parecer T08.5 continua NO_GO.
