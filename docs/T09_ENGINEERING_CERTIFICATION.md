# T09 — Certificação técnica do Capability Fabric multissetorial

**Pré-requisito:** T08.4 certificada na PR #24; merge `3060be23dd11fa75d396bca8f63544e0c13058e6`; CI pós-merge `#44972851608 SUCCESS`.

**PR de implementação:** [#25](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/25) — `feat/t09-capability-fabric-multisector`.

**HEAD de código testado:** `bd2e1d3e49d84efde02a4bf6360f9fd3c3083ec6` — CI [#44975161245](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44975161245). A confirmação de CI integral final, merge e CI pós-merge deve ser registrada no comentário de fechamento da PR; não inferir sucesso de uma execução em andamento.

## Matriz de aceite

| Requisito T09 | Implementação e prova |
|---|---|
| Contratos horizontais, registro de capacidades | `src/capabilities/model.ts`, `catalog.ts`, dispatcher de módulos compilados, sem códigos executáveis de clientes |
| 6 templates multissetoriais | FOOD_SERVICE, RETAIL, SERVICES, BEAUTY, HEALTH_SERVICE e OTHER, com manifests `READY_INTERNAL` ou `PLANNED` |
| Segregação de 3 tenants (DoD) | Testes em food, retail e beauty com atribuições, módulos, dados e unidades isoladas |
| Versões, concorrência, rollback | Repository Firestore com revisões imutáveis/CAS, 20 alterações concorrentes e rollback auditado |
| Migração segura | Perfil T02 define vertical/modo; guardas para operações alimentares abertas em serviço e na transação Firestore |
| Acesso autorizado | API autenticada, membership, RBAC OWNER/ADMIN para mutações, perfil/versão/unit/tenant validados |
| Ativação real indevida | Capabilities futuras não executáveis; nenhum go-live; restrições legadas T02–T08 e feature flags T08.3 preservadas |
| Integração dos módulos à aplicação | API `/api/capabilities`, painel `CapabilityManager`, KDS nativo somente sob atribuição e perfil compatíveis |
| Impossibilidade de contorno | Guardas de FOOD_ORDERING, FOOD_PRODUCTION e FOOD_FINANCE nos endpoints reais e comandos T07 de agentes |
| Testes cumulativos | `tests/t09CapabilityFabric.test.ts` (15), `tests/t09BusinessProfileIsolation.test.ts` (4), `tests/t09CapabilityHttpGuard.test.ts` (3); suíte T01–T09, Docker runtime/staging e Python |

**Contagem esperada em CI com a implementação final:** 422 testes TypeScript em 70 arquivos; gate T09 com 22 testes específicos; 7 testes Python cognitivos e 8 testes Python operacionais da T08.3. O resultado efetivamente certificado deve ser extraído do log do HEAD final e da CI pós-merge antes do fechamento.

## Critérios de integridade e limitações

A aplicação não usa nome, endereço, CEP, telefone, chave Pix, cardápio ou modo operacional de nenhum cliente fixado no código; tudo é configurável e versionado por estabelecimento/unidade. Manifests são contratos da aplicação, não fichas de empresas. A seleção interna não permite agendar, reservar, cadastrar estoque ou executar checkout multissetorial antes da implementação/certificação T10–T12.

**Não houve:** cadastro real da proprietária, deploy em produção, transação bancária, envio Meta, integração PDV externa, conclusão de 10 jornadas reais nem autorização de go-live. O aceite T08.5 segue NO_GO. Não confundir dados simulados dos testes com homologação externa.

**Trava:** T10 só após PR #25 integrada com CI no último HEAD aprovado e CI pós-merge `main` SUCCESS. Pendências externas T08.5 não bloqueiam a engenharia horizontal.
