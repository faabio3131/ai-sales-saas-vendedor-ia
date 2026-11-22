# T09 — Capability Fabric multissetorial | arquitetura e operação

**Pré-requisito certificado:** T08.4 PR #24, merge `3060be23dd11fa75d396bca8f63544e0c13058e6`, CI pós-merge #44972851608 SUCCESS.

## Escopo da engenharia
O núcleo atende empresas de diferentes verticais com uma única camada de autorização, catálogo de contratos estáticos, atribuições versionadas por tenant/unidade, comandos de configuração, rollback e dispatcher de handlers injetados em código. Não contém dados particulares de estabelecimentos. Nenhum módulo futuro pode ser ativado por configuração isolada.

### 1. Manifests / templates
- `src/capabilities/model.ts` e `catalog.ts`: manifest tipado por capability, domínio, dependências, versão e maturidade `READY_INTERNAL` / `PLANNED`. Domínio e maturidade não são configuráveis por cliente.
- Templates versionados: `FOOD_SERVICE_STD` (alimentação), `RETAIL_STD` (comércio), `SERVICES_STD` (serviços), `BEAUTY_STD` (estética), `HEALTH_ADMIN_STD` (administração clínica) e `GENERAL_STD` (outros).
- Para cada template, os defaults ativam apenas recursos CORE internos. `SCHEDULING`, booking, retail checkout/inventory e beauty/health packs permanecem `PLANNED` e recusados pela API/dispatcher, até implementação e certificação nas T10–T12.
- O template não carrega endereço, CEP, telefone, preço, cardápio, conta bancária, canal, dados da Pizzaria Americana ou segredo. Tudo isso continua em registros versionados de cada estabelecimento e vaults existentes.

### 2. Autoridade e ciclo de vida
- `src/capabilities/service.ts`: valida identidade do tenant proveniente de membership, unidade, OWNER/ADMIN para comandos, correspondência de `BusinessVertical` ao perfil T02 e dependências entre capabilities.
- `provision-defaults` cria a revisão 1 a partir do perfil T02 vigente. `revisions` permite ativar somente capabilities `READY_INTERNAL` com prova de autorização e `expectedVersion` correto.
- `src/capabilities/firestoreRepository.ts`: um ponteiro hash por tenant/unidade e revisões históricas imutáveis; Firestore transaction com CAS e checagem simultânea do ponteiro do perfil T02. Nenhuma revisão antiga é editada.
- `rollback` cria nova revisão com `rollbackOfVersion`, mantendo histórico, motivo, autor e versão; proíbe rollback para versão inexistente, corrente ou do futuro.
- Migração/desativação de uma unidade alimentar com pedidos confirmados ainda em andamento é rejeitada por `CapabilityOperationalState` e novamente pela transação Firestore; mudanças de vertical, modo e remoção de flags operacionais no perfil T02 também são protegidas.
- O estado `ENABLED_INTERNAL` NÃO habilita produção, PSP, Meta, SMS, PDV ou operação comercial. Continua obrigatória a governança T08.3/T08.5, além das políticas legadas de T02–T07.

### 3. Capability Dispatcher (extensibilidade, não plugin arbitrário)
- `src/capabilities/dispatcher.ts` recebe somente handlers explicitamente instalados pelo software e identifica o módulo com `CapabilityId` tipado.
- Antes de chamar um handler, exige resolução ativa e compatível com perfil e tenant/unidade. O contexto do handler contém apenas tenantId, unitId, userId, role e assignmentVersion verificados.
- Não executa `eval`, scripts enviados por empresas, URLs arbitrárias ou código descoberto em campos mutáveis. Capabilities não registradas, não implementadas ou não autorizadas falham fechadas.
- Domínios FOOD/RETAIL/SERVICES/BEAUTY/HEALTH não importam lógica especializada para o kernel genérico. Implementações futuras devem usar contratos de módulos injetados.

### 4. API e painel do cliente
- A API em `/api/capabilities/units/:unitId` está montada após autenticação + `tenantAuthorizationMiddleware`: GET `catalog`, `assignment`, `resolve/:capability`, `revisions/:version` (histórico reservado a OWNER/ADMIN); POST `provision-defaults`, `revisions`, `rollback` (OWNER/ADMIN).
- Campos de mutação são estritamente validados; IDs de tenant/unit não entram no body, apenas no contexto autenticado e path validado.
- `src/ui/CapabilityManager.tsx`: painel por empresa e unidade, template específico da vertical, módulos internos/futuros, dependências, provisionamento inicial, salvar versão, rollback e avisos de não-go-live.
- O antigo painel KDS, que aparecia genericamente no workspace, é exibido somente quando o registro T09, o perfil T02 e o modo nativo permitem FOOD_ORDERING e FOOD_PRODUCTION.

## Matriz DoD e evidências automatizadas
| Prova | Arquivos | Aceite |
|---|---|---|
| 3 tenants segmentos distintos, isolamento e seleção | `tests/t09CapabilityFabric.test.ts` | FOOD, RETAIL e BEAUTY, escopo das unidades, sem vazamento ou contaminação |
| 6 verticais e contracts | `tests/t09CapabilityFabric.test.ts` | Templates e dependências tipadas, versão e maturidade, sem clientes fixos |
| Auth + RBAC e HTTP | `tests/t09CapabilityFabric.test.ts` | OWNER/ADMIN alteram, VIEWER não altera, tenant estrangeiro não vê atribuições |
| CAS e rollback | `tests/t09CapabilityFabric.test.ts` | 20 updates concorrentes produzem um único vencedor; histórico imutável |
| Migração segura | `tests/t09CapabilityFabric.test.ts`, `tests/t09BusinessProfileIsolation.test.ts` | Mudança de capabilities com pedidos food abertos bloqueada |
| Capabilities futuras | `tests/t09CapabilityFabric.test.ts` | Não ativar scheduling/beauty booking/retail checkout |
| Separação T02/T09 | `tests/t09BusinessProfileIsolation.test.ts` | Food-only flags proibidas em RETAIL/BEAUTY/HEALTH |
| Dispatcher | `tests/t09CapabilityFabric.test.ts` | Handler não instalado/tenant errado/planned não executa |
| Regressão integral | `.github/workflows/blk010-validation.yml` | Build, typecheck, testes T01–T09, Python, isolamento, staging, Docker |

## Restrições e migração gradual
1. Confirmar perfil T02 e sua versão, inclusive vertical e modo do estabelecimento; perfis ausentes/planejados não podem ser provisionados.
2. Se for empresa food preexistente, verificar pedidos abertos; não alterar seleção de capacidades ou modo durante operação inacabada.
3. Usar a API/painel para provisionar defaults conservadores, revisar módulos e dependências e salvar uma nova revisão. Nunca editar código com informações de cliente.
4. Se houver regressão, fazer rollback como nova revisão sob papel OWNER/ADMIN; certificar a nova versão antes de qualquer ativação comercial.
5. Aprovação externa e ativação das aplicações são gates independentes. T09 não substitui pagamentos reais, homologação da proprietária, T08.5 nem as tarefas T10–T12.

**Próxima tarefa:** T10 — Scheduling Engine horizontal, somente após CI cumulativa pós-merge T09. A T08.5 real segue NO_GO e não deve bloquear a engenharia.
## 5. Enforcement funcional T09 no runtime

A configuração efetivamente governa o acesso operacional. O middleware `src/capabilities/httpGuard.ts` foi adicionado aos roteadores reais de `/orders` (FOOD_ORDERING), `/order-payments` (FOOD_ORDERING), `/fulfillment` (FOOD_PRODUCTION) e `/finance` (FOOD_FINANCE), sempre depois de autenticação e membership de tenant. Ausência de assignment, configuração desabilitada ou unidade errada falham fechadas, sem execução do domínio. As ferramentas de autonomia governada `ORDER_DRAFT`, `ORDER_CONFIRM`, `PAYMENT_CREATE` e `PRODUCTION_RELEASE` também verificam capabilities na origem do runtime, evitando contorno pelo gateway de agentes. Reconciliadores assíncronos de pagamentos existentes continuam autorizados a reconciliar operações previamente persistidas; a segurança financeira não é interrompida por mudanças de seleção.

`tests/t09CapabilityHttpGuard.test.ts` verifica o bloqueio de pedidos sem provisionamento, liberação após seleção da capability, isolamento de tenant/unidade, impedimento de paths maliciosos, guardas de produção/financeiro e não exibição de KDS sem configuração. Nenhum teste utiliza contas ou dados reais.
