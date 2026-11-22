# T08.3 — Certificação de engenharia (ambiente controlado)

**Data local:** 21/11/2026.  
**Dependência:** T08.2 PR #22, main `75b3411858298ebf496c52766e35966a0bcf7c55`, CI pós-merge #44966871296 SUCCESS.  
**Entrega:** PR #23; HEAD do código de engenharia `e9c8ac6f894bc91b75c6b210a4f32f0a186ee6da`.  
**CI cumulativa do código:** [#44968619639](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44968619639) — **SUCCESS**.  
**Gate adicional:** merge autorizado só depois da CI da PR no HEAD documental final; emitir CI pós-merge da main. O documento não atesta esses eventos antecipadamente.

## Matriz de engenharia implementada

| Requisito | Evidência interna | Limite comprovado |
|---|---|---|
| Kill switch e feature flags | `src/operations/pilotFlags.ts`, `tests/t08_3PilotFlags.test.ts` | PSP create e WhatsApp outbound só liberados com controle global + aprovação declarada em env + tenant/unidade/capability exatos |
| Caminhos protegidos | `src/payments/service.ts`, `src/orderPayments/service.ts`, `src/channels/whatsappDelivery.ts` e legado `src/channels/service.ts` | Contrato legado WhatsApp sem unidade autenticada fica proibido de envio real |
| Staging isolado | `deploy/t08-3-staging.compose.yaml` + gate CI `docker compose config` | Bind exclusivo 127.0.0.1, sem conexão de workers, sem publicação em proxy/Cloud Run/Contabo |
| Deploy reproduzível | `scripts/t08_3_ops.py deploy` + teste Python e staging Docker smoke CI | CLI exige imagem OCI por digest e projeto staging, dry-run por padrão, health antes de gravar estado |
| Backup | `scripts/t08_3_ops.py backup` + teste com mock do gcloud | Export Firestore com espera de operação `done` antes de evidência, sem export real executado |
| Restauração | `scripts/t08_3_ops.py restore` + teste de isolamento | Import apenas em projeto staging distinto, exige dupla confirmação; nenhum restore real executado |
| Rollback | `scripts/t08_3_ops.py rollback` + testes de reversão e falha de health | Reimplanta a imagem anterior em staging; não é rollback de Firestore, não promete zero downtime |
| Segurança | `read_only`, `cap_drop`, `no-new-privileges`, tmpfs, segredo fora do Git, `.t08-3/` ignorado | Sem credenciais bancárias, Meta ou dados reais de cliente na CI |

## Resultado cumulativo

- **380 testes TypeScript PASS** em Vitest local à CI (64 arquivos).
- **7 testes Python PASS** para o serviço cognitivo.
- **8 testes Python PASS** específicos de backup, restauração, deploy e rollback.
- **Docker build:** 379 testes TS PASS, 1 SKIP por ambiente (total de 380), zero falhas.
- **Build, typecheck, isolamento de autenticação, limites de payload, health, configuração de cofre e staging Compose:** PASS.
- **Smoke real de contêiner em staging de CI:** PASS; somente loopback, flags live desligadas.
- **Smoke do contêiner cognitivo privado:** PASS.

## Não declarados como concluídos

1. Restauração real de backup Firestore em projeto GCP autorizado; comprovação de conteúdo, índices, RPO/RTO e lifecycle de bucket.
2. Implantação ou rollback no host real Contabo, Cloud Run ou proxy existente, com secrets/identidades e telemetria reais.
3. Credenciais PSP/WhatsApp, webhook real, transação bancária real, aceitação da Pizzaria Americana, homologação das dez jornadas e autorização T08.5.
4. Efeitos de transferência de tráfego, cutover, alta disponibilidade e continuidade operacional de produção.

**Critério:** estes itens não bloqueiam a conclusão da engenharia T08.3 de staging e dos mecanismos de recuperação, mas bloqueiam alegar ambiente real homologado ou realizar go-live. T08.4 só inicia após CI pós-merge T08.3 verde, obedecendo a trava sequencial.
