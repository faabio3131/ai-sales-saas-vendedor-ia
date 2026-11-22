# ATENDEVENDEIA — COGNITIVE COMMERCE PLATFORM
## Cronograma Mestre de Execução com Trava Sequencial e Controle de Entregas

**Organização:** FM Tecnologia IA  
**Repositório de destino:** `faabio3131/ai-sales-saas-vendedor-ia`  
**Documento de referência:** `ATENDEVENDEIA_ARQUITETURA_MESTRE_COGNITIVE_CORE_V1.md` (v1.0 — 20/11/2026)  
**Projeto-piloto:** Pizzaria Americana  
**Autoridade final:** Diretor/Proprietário da FM Tecnologia IA  
**Revisão documental:** v1.2 — 21/11/2026 (separação código/configuração e engenharia/homologação)  
**Decisão confirmada:** núcleo comercial universal + especialização alimentar prioritária + dois modos operacionais por estabelecimento/unidade.  
**Status deste aditivo:** Diretor autorizou a continuidade da ENGENHARIA sem aguardar documentação/credenciais/aceite externos. Persistem travas de certificação interna por bloco e proibição de ativação real sem homologação, credenciais autorizadas e aprovação humana. Nenhuma aprovação comercial é presumida.  

---

## 0. Direção estratégica aprovada — plataforma horizontal, piloto alimentar e dois modos

**Decisão do Diretor, 21/11/2026:** o AtendeVendeIA será uma plataforma **universal, multissetorial e multiempresa**, com um **núcleo comercial horizontal** (identidade e tenant, conversações, IA, conhecimento, CRM, catálogo, orçamento, venda, pagamentos, notificações, memória, métricas e governança). Setores utilizarão **Business Capability Packs** isolados e configuráveis, sem duplicar núcleo, sistemas financeiros, contas ou permissões. A primeira especialização funcional será o **Food Service Pack**, voltado à jornada alimentar completa da **Pizzaria Americana**.

**Jornada comercial fechada obrigatória para o primeiro piloto:** mensagem do cliente → identificação e consulta a catálogo/regras → composição do pedido → confirmação explícita → cálculo determinístico → pagamento conforme política → encaminhamento à operação → acompanhamento verdadeiro de preparação/entrega/retirada → conclusão → pós-venda e recuperação autorizada. Estados de **pedido, pagamento e entrega** são independentes; a IA não inventa disponibilidade, preço, status, recebimento ou ações realizadas.

### 0.1 Dois modos operacionais por tenant/unidade — decisão vinculante

| Modo | AtendeVendeIA controla | Sistema de operação / fonte de confirmação | Regra obrigatória |
| :--- | :--- | :--- | :--- |
| **NATIVE_OPERATIONS** — painel próprio | Recebe e controla o pedido, fila de produção/retirada/entrega, eventos, notificações e permissões de operador | **Painel operacional do AtendeVendeIA**, com ações humanas autenticadas | Apenas um encaminhamento por pedido/versão; somente eventos persistidos autorizam informar preparo, pronto, despacho ou entrega |
| **INTEGRATED_OPERATIONS** — sistema já utilizado | Atendimento, orçamento, confirmação comercial, vínculo com pagamento, referências, reconciliação e visão do pedido | **PDV/KDS/delivery externo homologado**, via adaptador contratual | Não duplicar produção em painel próprio; não assumir sucesso por mero envio; receber ACK/status externo verificado e mapear a estados canônicos |

- O modo é configurado e versionado pelo proprietário por **tenant/unidade**, com RBAC, auditoria, feature flags e aplicação **fail-closed**. A ausência de modo válido bloqueia liberação à produção; nunca improvisar destino.
- **Order Engine canônico continua universal**: mantém identidade do pedido, valores, cliente, cobrança, snapshots e correlação. No modo integrado, o sistema externo é autoridade **somente sobre estados operacionais que ele realmente reporta**; o AtendeVendeIA registra o espelho verificável com origem/horário/versão, sem substituir seu estado comercial e financeiro por dados não autenticados.
- Contrato de integração: `IntegrationPort`/`ProductionDispatchPort`, versão e capability registry; `tenantId`, `unitId`, `orderId`, `orderVersion`, `idempotencyKey`, `correlationId`, `externalOrderRef`, ACK e eventos autenticados; inbox/outbox e retries controlados, DLQ, backpressure e reconciliação quando suportada. Sem conector homologado, **INTEGRATED_OPERATIONS fica indisponível**, com encaminhamento humano autorizado como contingência explícita, sem alegar sincronização.
- Um pedido não pode ser encaminhado simultaneamente ao painel e ao PDV externo. Troca de modo com pedidos abertos exige plano de migração/encerramento e aprovação do proprietário; proibir troca silenciosa, reenvio ou criação de pedido duplicado.
- **Aceite interno:** ambos os modos passam testes de contrato e E2E simulados independentes, incluindo falha de ACK, duplicidade, atraso, eventos fora de ordem, reconexão, rollback, isolamento por tenant/unidade e concorrência. **Aceite real T08:** homologar o modo efetivamente escolhido pela Pizzaria Americana; não exigir PDV externo se a loja operar no modo nativo. O outro modo permanece desabilitado até homologação individual.

### 0.2 Extensão multissetorial sem desvio do piloto

- A base horizontal deve oferecer `BusinessCapabilityRegistry`/perfil por tenant com capabilities explícitas e versionadas (`ORDERING`, `PRODUCTION`, `DELIVERY`, `APPOINTMENTS`, etc.), políticas, canais e conectores; **não implementar uma lista rígida de nichos dentro do Core**.
- **Depois da engenharia interna do piloto alimentar**, estudar e implementar um **Scheduling Engine horizontal** (disponibilidade, agenda, profissionais/recursos, duração, bloqueio transacional de horário, reservas, remarcação, cancelamento, lembretes e sinal de pagamento). Adapters configuráveis atenderão **salões/barbearias** e **clínicas de estética**. Agendamento não é sinônimo de pedido; preservar invariantes e contratos próprios.
- Em estética, o escopo inicial será **atendimento administrativo, agendamento e comercial**. Não fornecer triagem/diagnóstico médico ou recomendações clínicas autônomas; informações sensíveis exigem proteção e autorização específicas.
- Expansões para lojas e serviços serão novos capability packs, sem reescrever tenancy, pagamento, memória ou IA; **T09+ seguem a sequência de engenharia interna após certificação técnica da T08.4, sem depender da homologação externa T08.5**. Go-live de qualquer pack continua condicionado à sua homologação.
- O planejamento multissetorial não transforma este trabalho em ERP, prontuário, RH, estoque avançado, sistemas contábeis ou produção de cozinha do Kordena.

### 0.3 Critério de prioridade de implantação

1. **Agora:** engenharia integral do Food Service Pack e a jornada fechada da Pizzaria Americana, seguindo T01→T07.
2. **Nesta semana de preparação com a cliente:** é permitido **levantar e validar dados reais** (cardápio, regras de pizza, modalidades de pagamento, bairros, valores, horários, perfis, modo nativo/integrado), em documento de coleta **sem ativar contas, conexões ou a produção**. Essa coleta não conclui nem destrava T08.1.
3. **Após T07 certificado:** executar T08.1→T08.5, homologar o modo escolhido com a proprietária, realizar piloto e aprovar o go-live.
4. **Após certificação interna das etapas T08.2–T08.4:** o desenvolvimento T09+ pode avançar sequencialmente sem esperar aceite de terceiros ou go-live da pizzaria. A autorização real de operar cada estabelecimento permanece independente.

---

## 1. Regras de Trava e Governança (Obrigatórias)

> **Regra do Diretor:** Completar uma tarefa 100%, executar testes consolidados, corrigir falhas, certificar e **somente então** avançar. Não fragmentar a entrega em PRs triviais; não remover testes obrigatórios; não simular aprovação real.

### 1.1 Cinco requisitos cumulativos para destravar a próxima tarefa
Uma tarefa `T(n+1)` permanece **`🔒 BLOQUEADA`** até que `T(n)` tenha simultaneamente:
1. **Status marcado como:** `[x] ENTREGUE`
2. **Data de Entrega** registrada (`DD/MM/AAAA`)
3. **Evidência Obrigatória** preenchida (**PR consolidada + SHA do HEAD certificado + Link da Run de CI verde**)
4. **Critérios de aceite e cobertura integral da tarefa** verificados em relatório, incluindo testes de regressão, isolamento multi-tenant/unidade e DoD específico.
5. **Autorização explícita do Diretor para avanço** registrada quando a tarefa altera escopo, arquitetura ou promove a próxima etapa, conforme autoridade documental do projeto.

**Trava lógica, não meramente visual:** o estado `[x] ENTREGUE` é inválido sem os campos de data, PR, SHA, CI verde e relatório de cobertura. Qualquer executor deve verificar o gate anterior antes de abrir implementação da tarefa seguinte. Este arquivo **não implementa por si só** uma proteção automática de branch/CI; a automação dessa política deverá ser proposta, implementada e certificada separadamente antes de ser declarada efetiva.

### 1.2 Desacoplamento de Dependências Externas
- **Trilha 1 (`T01` a `T07` — Construção Interna 100%):** Zero bloqueio por órgão externo, credencial real de PSP, conta WhatsApp ou cadastro da Pizzaria Americana. Validação feita por contratos oficiais, adapters sandbox/mock determinístico, testes de isolamento e smoke runtime.
- **Trilha 2 (`T08.1` a `T08.5` — Engenharia alimentar e piloto real):** T07 e engenharia T08.1 certificadas. **T08.2 concluída em engenharia interna e T08.3 liberada para construção após confirmação do merge e da CI da main**, sem aguardar aceite da proprietária, chaves bancárias ou Meta. T08.3 e T08.4 são liberadas para construção/certificação interna após a conclusão técnica da etapa anterior; **ativação real, homologação dos 10 fluxos reais e T08.5 permanecem `NO_GO`** até autorização e dependências externas. Nunca confundir CI/mocks com credenciais ou aceite reais.
- **Trilha 3 (`T09` a `T12` — Expansão multissetorial):** implementação inicia sequencialmente após certificação **interna T08.4**, sem vincular o desenvolvimento ao go-live T08.5. Homologação externa de cada setor é uma trava apenas para sua entrada em operação real.

### 1.3 Regras de emissão, qualidade e congelamento
- Toda PR da tarefa deverá citar ID da tarefa, dependência concluída, DoD, alterações de contratos, testes, riscos, migração/rollback e evidências. **Sem merge por antecipação** ou marcação de DONE por CI de outra frente.
- Uma CI de pagamento verde **não certifica** Order Engine, modo integrado, Food Pack, WhatsApp real ou piloto; comprova somente o escopo efetivamente coberto.
- Mudanças de escopo/arquitetura exigem ADR e autorização prévia; implementar uma tarefa inteira antes de abrir a seguinte. Bloqueios externos são listados em T08 e não servem de justificativa para deixar engenharia interna incompleta.
- Sem deploy/ativação real, conciliação externa ou pagamento real, registrar como **NÃO HOMOLOGADO**, ainda que existam mocks e smoke Docker.

### 1.4 Sequência Obrigatória por Tarefa
`READ → PLAN → IMPLEMENTAÇÃO INTEGRAL → BUILD/TYPECHECK → TESTES CONSOLIDADOS → REVIEW → FIX → VALIDATE → CERTIFY → REPORT → NEXT`

---

## 2. Painel de Controle de Entregas

### Trilha 1 — Construção Interna 100% (Zero Bloqueio Externo)

| ID | Gate / Trava | Entrega Funcional Consolidada | Prazo Est. | Status | Data Entrega | Evidência (PR / SHA / CI Run) |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- |
| **T01** | `✅ ENTREGUE` | Integração Cognitiva (ADR-001/002: FM Core Base + Padrões NFCore + Adaptador TS) | 7d | `[x] ENTREGUE` | `21/11/2026` | `PR #11 / SHA c150420e9d7cb66ca4335baadd5796fea6fd761a / CI #44906758883 SUCCESS` |
| **T02** | `✅ ENTREGUE` | Conhecimento e Memória por Estabelecimento (Tenant) | 5d | `[x] ENTREGUE` | `21/11/2026` | `PR #12 / SHA 5a89a5580ede7e3c45041008808deebf692691d7 / CI #44917033763 SUCCESS` |
| **T03** | `✅ ENTREGUE` | Catálogo e Order Engine universais + Food Pack (cardápio e regras alimentares) | 7d | `[x] ENTREGUE` | `21/11/2026` | `PR #13 / SHA 47bc7e8cd6ec28a9cef8536b0395ca3b430096b5 / CI #44922979257 SUCCESS` |
| **T04** | `✅ ENTREGUE` | Payment Engine (Pix Dinâmico, Checkout Governado, Webhooks e Reconciliação) | 8d | `[x] ENTREGUE` | `21/11/2026` | `PR #14 / SHA 704304eb98635479f168f2a932517772b9ba8db3 / CI #44935718242 SUCCESS` |
| **T05** | `✅ ENTREGUE` | Gestão Financeira Comercial e Consultas Administrativas IA | 6d | `[x] ENTREGUE` | `21/11/2026` | `PR #15 / SHA 49dcae65424c2f579cc650803e6b88aff1c34f9b / CI #44940142925 SUCCESS` |
| **T06** | `✅ T05 autorizado` | Food Service Pack — delivery, produção e 2 modos (nativo/integrado) | 6d | `[x] ENTREGUE INTERNAMENTE` | `21/11/2026` | `PR #16 / SHA 3058161dd0a08486f3ca80d2e135d01c8d5e194a / CI #44954585318 SUCCESS` |
| **T07** | `✅ T06 concluída + autorização do Diretor em 21/11/2026` | Autonomia Operacional Governada e Resolução de Exceções | 6d | `[x] ENTREGUE INTERNAMENTE` | `21/11/2026` | `PR #18 / SHA 588d6ce4491cb14ea4380b8edeedb276dc364c1e / CI #44957683634 SUCCESS` |

### Trilha 2 — T08: Piloto Pizzaria Americana & Habilitação Externa (Pós-T07)

| ID | Gate / Trava | Etapa do Piloto e Certificação Externa | Prazo Est. | Status | Data Entrega | Evidência (Runbook / Logs / Aprovação) |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- |
| **T08.1** | `✅ Engenharia certificada` | Configuração multiempresa/unidade e coleta de dados da Pizzaria Americana | 3d | `[x] ENGENHARIA CONCLUÍDA / [ ] ACEITE CLIENTE EXTERNO NO_GO` | `21/11/2026 (código)` | `PR #19/#20 e API genérica de estabelecimentos; cliente no Firestore` |
| **T08.2** | `✅ T08.1 engenharia certificada` | Provisionamento seguro multibanco por tenant, canal WhatsApp oficial por unidade, PagBank ECDSA, Meta HMAC/webhooks, inbox/outbox, testes e observabilidade | 3d | `[x] ENGENHARIA INTERNA CERTIFICADA / [ ] ATIVAÇÃO REAL EXTERNA PENDENTE` | `21/11/2026 (código)` | `PR #22 / CI #44966258243 SUCCESS (375 TS PASS + 7 Python PASS); merge e CI pós-merge no histórico da PR` |
| **T08.3** | `✅ T08.2 PR #22 + CI #44966871296 SUCCESS` | Flags por tenant/unidade, compose staging isolado, deploy controlado, backup/import Firestore staging, rollback e testes | 3d | `[x] ENGENHARIA INTERNA CERTIFICADA / [ ] DEPLOY REAL EXTERNO NO_GO` | `21/11/2026 (engenharia)` | `PR #23 / merge cdf19a8 / CI pós-merge #44969942528 SUCCESS; 382 TS + 15 Python; staging Docker PASS` |
| **T08.4** | `✅ T08.3 PR #23 + CI #44969942528 SUCCESS` | Dez jornadas internas, 2 modos, PSP webhook mock + GET, KDS/PDV/ACK, WhatsApp oficial por unidade, resiliência | 4d | `[x] ENGENHARIA INTERNAMENTE TESTADA / [ ] HOMOLOGAÇÃO EXTERNA NO_GO` | `21/11/2026 (código)` | `PR #24 / SHA código 46720031fca33bd0de1c6d282bc798194dfd6093 / CI #44972280781 SUCCESS; matriz 10/10 + modos 8/8. CI pós-merge a registrar na PR` |
| **T08.5** | `🔒 Engenharia T08.4 + aceite/homologação EXTERNA real` | Diretor aprova ou nega go-live após evidência real e rollback | 2d | `[ ] NO_GO REAL, NÃO BLOQUEIA ENGENHARIA FUTURA` | `__/__/____` | `Autorização formal e homologação reais ___` |

### Trilha 3 — Expansão Horizontal e Agendamentos (Pós-piloto, sem antecipar T08)

| ID | Gate / Trava | Entrega Funcional Consolidada | Prazo Est. | Status | Data Entrega | Evidência (PR / SHA / CI Run) |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- |
| **T09** | `✅ T08.4 PR #24 + CI #44972851608 SUCCESS` | Capability Fabric multissetorial, 6 templates versionados, ativação e rollback por tenant/unidade, proteção de rotas | 5d | `[x] IMPLEMENTAÇÃO E TESTES T09 / [ ] GATE FINAL CI, MERGE E PÓS-MERGE` | `21/11/2026 (engenharia)` | `PR #25 / código bd2e1d3e49d84efde02a4bf6360f9fd3c3083ec6 / CI #44975161245 em execução ao registrar; evidência final na PR` |
| **T10** | `✅ T09 PR #25 + CI #44975729301 SUCCESS` | Scheduling Engine horizontal, recursos/profissionais, reserva atômica, agenda, turnos, feriados, sinal opcional e lembretes internos | 8d | `[x] IMPLEMENTAÇÃO / [ ] CERTIFICAÇÃO INTEGRAL E PÓS-MERGE` | `21/11/2026 (engenharia)` | `PR #26 / CI do HEAD e pós-merge exigidas; resultado final na PR` |
| **T11** | `🔒 Finalize T10` | Service Booking Packs — salão, barbearia e clínica de estética (escopo administrativo) | 7d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T12** | `🔒 Finalize T11` | Templates de comércio/serviços, onboarding por capabilities e certificação multissetorial | 6d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |

> Os prazos são **estimativas de esforço, não datas prometidas**. O desenvolvimento T09–T12 segue a trava de **entregas internas**, sem depender de aceites externos do primeiro restaurante. Nenhum pack é ativado comercialmente antes de homologação própria.

---

## 3. Detalhamento Técnico e Critérios de Aceite (DoD)

### T01 — Integração Cognitiva (`✅ ENTREGUE — 21/11/2026`)
- **Escopo:** Auditar SHAs e inventário dos 3 repositórios (`FM-Core-Base-`, `cognitivo-nfcore-inteligencia-fiscal`, `ai-sales-saas-vendedor-ia`); reconciliar drift com runtime; formalizar ADR-002 (serviço cognitivo Python interno + adaptador TypeScript preservando `AIRouterInterface`, sem escrita direta no banco comercial); integrar roteamento, Context Pack Builder, Output Guard, proveniência, redaction, resiliência (deadline, circuit breaker, bulkhead, fallback) e FinOps.
- **Critério de Aceite (DoD):**
  - [x] Jornada comercial existente exercita a fundação cognitiva de ponta a ponta.
  - [x] Saída estruturada validada, timeout/fallback, isolamento de tenant e segurança testados.
  - [x] Build, typecheck, suíte cumulativa e smoke runtime aprovados no mesmo HEAD.
  - [x] Contratos simulados registrados separadamente de credenciais reais de provedor.

### T02 — Conhecimento e Memória por Estabelecimento (`✅ ENTREGUE — 21/11/2026`)
- **Escopo:** Definir e validar o `BusinessCapabilityRegistry` mínimo por tenant/unidade (`FOOD_SERVICE`, `ORDERING`, `PRODUCTION`, `DELIVERY`, `OPERATION_MODE`, flags versionadas) como contrato horizontal reutilizável; não implementar o Scheduling Engine nesta tarefa. Implementar `BusinessKnowledge` e `PolicyProfile` versionados com vigência; catálogo e regras como fontes de verdade; `Memory Layer` com histórico, preferências e retenção configurável por cliente/tenant; identidade configurável da atendente; tratamento de lacunas e contradições.
- **Critério de Aceite (DoD):**
  - [x] Dois tenants distintos configurados com cardápios e políticas diferentes, zero vazamento cruzado.
  - [x] Respostas fundamentadas em evidências reais, sem invenção de preços ou horários.
  - [x] Alterações respeitam versão e vigência; memória persistida e governada.
  - [x] O perfil de negócio e o modo operacional são persistidos e versionados por tenant/unidade, com alteração autorizada, fail-closed e teste de isolamento. Nenhum nicho é hardcoded no Core.

### T03 — Motor de Pedidos e Regras Comerciais (`✅ ENTREGUE — 21/11/2026`)
- **Escopo:** Completar `Catalog Engine` (produtos, variantes, tamanhos, bordas, adicionais, combos, múltiplos sabores e regra configurável de meio a meio) e `Order Engine` (valores em centavos inteiros BRL, snapshot imutável do catálogo, numeração atômica única por tenant/unidade, separação das dimensões Pedido/Pagamento/Entrega e cotação básica de entrega).
- **Critério de Aceite (DoD):**
  - [x] Jornada completa de pedido repetível com cálculo determinístico exato.
  - [x] Concorrência na numeração, idempotência, alteração, cancelamento e titularidade testados.
  - [x] Nenhuma cobrança criada antes da confirmação explícita do cliente.
  - [x] O `Order Engine` é horizontal e independente de PDV, cozinha e plataforma de pagamento; contrato de despacho aceita ambos os modos sem executar despacho nesta tarefa.
  - [x] Casos alimentares cobertos: meio a meio, múltiplos tamanhos, bordas, adicionais, bebidas, combos, promoções, disponibilidade, opção retirada/delivery, snapshot e taxa configurável.

### T04 — Payment Engine (`✅ ENTREGUE INTERNAMENTE — 21/11/2026`)
- **Escopo:** Implementar `PaymentProviderPort` com adapters candidatos (Mercado Pago, PagBank, Asaas) em sandbox/contrato; Pix dinâmico (QR Code + Copia e Cola + expiração), checkout seguro de cartão (sem armazenar PAN), dinheiro na entrega e troco; webhook autenticado com validação de assinatura, valor, moeda, conta beneficiária e deduplicação; outbox transacional, reconciliação em worker com backoff/DLQ, estorno governado; atualizar `PolicyEngine` para autorizar `CREATE_PAYMENT` apenas sobre pedido confirmado; lançamentos financeiros mínimos para T05.
- **Critério de Aceite (DoD):**
  - [x] Testes contratuais/sandbox por adapter e integração pedido-pagamento aprovados.
  - [x] Exceções cobertas: timeout, Pix expirado, pagamento tardio, webhook duplicado/fora de ordem, valor divergente e estorno.
  - [x] Zero confirmação de pagamento baseada em texto, print ou confiança do LLM.
  - [x] Confirmação financeira/eventos duráveis não são confundidos com preparo ou entrega; dinheiro/cartão na entrega seguem confirmação operacional auditada, com papel e ator identificados.
  - [x] Reconciliar a base já implementada (PR #8 e #9, 21/11/2026) sem reimplementar adapters: faltas de outbox, vínculo pedido/pagamento e emissão de eventos são auditadas e só recebem status DONE quando certificadas.

### T05 — Gestão Financeira Comercial e Consultas Cognitivas (`✅ ENTREGUE INTERNAMENTE — 21/11/2026`)
- **Escopo:** Consolidar ledger comercial e projeções reconstruíveis; congelar definições de vendas brutas, vendas líquidas, recebimentos confirmados, recebimentos líquidos, pendentes, taxas, estornos, ticket médio e ranking de produtos; timezone do estabelecimento (`America/Sao_Paulo`), intervalos semiabertos e semana configurável; painel administrativo e consulta em linguagem natural autenticada via RBAC.
- **Critério de Aceite (DoD):**
  - [x] Totais reconciliam 100% contra transações conhecidas (dia, semana e mês).
  - [x] Bloqueio estrito de consultas administrativas em conversa pública ou sem RBAC válido.
  - [x] Separação clara entre receita do estabelecimento e métricas/custos de IA da FM.

### T06 — Delivery, Produção e Acompanhamento (`✅ ENTREGUE INTERNAMENTE — 21/11/2026`)
- **Escopo:** Implementar e certificar o **Food Service Pack com dois modos mutuamente exclusivos por estabelecimento/unidade**: `NATIVE_OPERATIONS` usa painel próprio de produção/fila/retirada/entrega; `INTEGRATED_OPERATIONS` usa adapter homologável de PDV/KDS/delivery existente, sem duplicar as operações. Construir contrato `ProductionDispatchPort` com ACK real, correlação, idempotência, outbox/inbox, retries/backoff/DLQ e fonte de verdade explícita dos estados. Proibir mudança silenciosa de modo durante pedido ativo. Completar `Delivery Engine` (validação de endereço/CEP, área atendida, regras de taxa, retirada, janela estimada fundamentada); painel/adapter operacional de produção, fila de despacho e eventos duráveis (`OrderReleasedToProduction`, `OrderReady`, `DeliveryDispatched`, `DeliveryCompleted`); notificações reais ao cliente baseadas no estado persistido.
- **Critério de Aceite (DoD):**
  - [x] Entrega normal, retirada e endereço fora da área testados.
  - [x] Liberação única à produção condicionada a pagamento confirmado ou modalidade autorizada.
  - [x] Reprocessamento e falhas não duplicam pedido na cozinha; zero promessa de GPS sem fonte real.
  - [x] Modo nativo: painel autoriza papéis operacionais, acompanha estados reais e informa o cliente somente após persistência.
  - [x] Modo integrado: contrato testado para ACK, idempotência, payloads, versionamento, deduplicação e estados externos; indisponível sem conector homologado, com fallback humano explicitamente governado.
  - [x] Ambos os modos possuem suíte interna de contrato/E2E; somente um destino de produção ativo por pedido e nenhum cross-tenant/unidade; integração externa real pertence ao T08 quando adotada pela pizzaria.

### T07 — Autonomia Operacional Governada e Exceções (`✅ CERTIFICADA INTERNAMENTE — 21/11/2026`)
- **Escopo:** Formalizar modos `ASSIST`, `COPILOT` e `AUTONOMOUS_GOVERNED`; Tool Gateway com allowlist estrita e recibos auditáveis; workflow formal de aprovação humana vinculada a escopo/valor/validade; integração com recuperação de vendas (respeitando consentimento/opt-out); bateria adversarial e de permissões.
- **Critério de Aceite (DoD):**
  - [x] Jornada interna de pedido rotineiro simulada de ponta a ponta, sem aprovação humana em `AUTONOMOUS_GOVERNED` dentro dos limites: rascunho determinístico → confirmação verificada → cobrança T04 → liberação T06 após confirmação/condição financeira. O gateway não simula recebimento; adaptações reais são T08.
  - [x] Riscos (alérgenos não confirmados, disputa financeira, desconto fora da política e prompt injection) escalados e bloqueados com classificação determinística e evidência confiável.
  - [x] Nenhuma elevação autônoma de privilégio; 336 testes TypeScript PASS / 58 arquivos e 7 testes Python PASS; CI integral #44957683634 SUCCESS.
  - [x] Contratos e E2E internos simulados de canal WhatsApp assinado, confirmação explícita, pedido/cobrança, modo operacional exclusivo, notificações T06 por outbox de estado persistido e recuperação condicionada ao opt-in; idempotência, replay e retry seguros. **Webhook WhatsApp/PSP real, envio real ao cliente e dez jornadas em produção são T08, não resultados T07.**
  - [x] Testes adversariais proíbem a IA de modificar `OPERATION_MODE`, habilitar integração externa inexistente, fabricar estado, conceder permissões, acessar finanças administrativas ou realizar estorno sem RBAC.
- **Evidência de fechamento:** `docs/T07_CLOSURE_CERTIFICATION.md`; commit funcional `588d6ce4491cb14ea4380b8edeedb276dc364c1e`, CI https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44957683634.

### T08 — Engenharia separada do go-live (T08.2/T08.3 certificadas; T08.4 engenharia certificada na PR; T08.5 real NO_GO)
- **T08.1:** Cadastro, endereço, telefones, nome da atendente, horários, catálogo e modo são **configurações versionadas por empresa/unidade no Firestore** (`/api/establishments`); código é horizontal. Material específico da Pizzaria Americana é fonte externa para digitação/importação autorizada, **não parte do runtime nem arquivo de dados da aplicação**. Aceite real da proprietária permanece `NO_GO` para ativação da pizzaria, **mas não impede construir T08.2**. Ver `docs/T08_1_OWNER_VALIDATION_RUNBOOK.md`.
- **T08.2:** Engenharia de inscrição bancária OWNER por tenant (apenas metadados), cofre GCP/mounted sem segredos em Firestore, habilitação somente operacional após prova externa; WhatsApp Cloud API por tenant/unidade com challenge Meta, HMAC do corpo bruto, WABA/phone binding, inbox persistente deduplicada, envio protegido por janela de 24h comprovada e outbox fail-closed. **Cliente real/credenciais/HTTPS/homologação ainda externos; não bloqueiam desenvolvimento T08.3.** Ver `docs/T08_2_SECURE_PROVIDER_ONBOARDING.md`.
- **T08.3:** Engenharia implementada na PR #23: compose isolado em loopback, kill switch e allowlist tenant/unidade fail-closed, CLI dry-run para deploy, backup/import Firestore entre projetos staging e rollback de imagem; testes e smoke Docker em CI. **Não houve backup/restore GCP reais, migração do backend Cloud Run ou worker Contabo, nem deploy público**. Continuam externos o inventário da infraestrutura efetiva, segredos de execução, homologação real e aprovação de go-live. Evidências: `docs/T08_3_ENGINEERING_CERTIFICATION.md`.
- **T08.4:** Matriz interna 10/10 e ambos os modos executada na PR #24 com doubles e componentes reais de domínio, sem chamadas financeiras/mensagens reais; sender oficial por tenant/unidade, confirmação/preparo apenas após eventos persistidos, ACK PDV mockado e deduplicação. A homologação das dez jornadas reais ainda é **0/10** e depende do modo que a proprietária escolher. Ver `docs/T08_4_INTERNAL_ACCEPTANCE_MATRIX.md` e `docs/T08_4_ENGINEERING_CERTIFICATION.md`.
- **T08.5:** Manual operacional, reconciliação diária, relatório final com evidências e autorização formal de Go-Live pelo Diretor.

---

## 4. Matriz de Cobertura 100%

### 4.1 Motores e Componentes Arquiteturais
| Componente | Tarefa Responsável | Cobertura |
| :--- | :---: | :---: |
| Commercial Cognitive Core (Router, Context Pack, Output Guard, Resilience, FinOps) | `T01`, `T07` | `[x] Guardrails/T01 e gateway de execução T07 certificados internamente; IA real em T08` |
| Business Knowledge & Memory Layer (Multi-tenant) | `T02` | `[x] T02 certificada (código interno; sem ativação externa)` |
| Catalog Engine & Order Engine | `T03` | `[x] T03 certificada internamente; cobrança/despacho em T04/T06` |
| Payment Engine (Pix Dinâmico, Checkout, Webhooks, Reconciliação) | `T04` | `[x] Engine e contratos internos certificados em T04 e T07; PSP real em T08.2` |
| Financial Engine & Admin Cognitive Queries | `T05` | `[ ] DoD da evolução não certificado` |
| Delivery, Production & Notification Engine | `T06` | `[x] Contratos e testes internos T06 e T07 certificados; canal real em T08` |
| Customer, Sales, Recovery & Autonomous Governance | `T01`, `T02`, `T07` | `[x] Modos/consentimento/aprovação/handoff e E2E internos T07 certificados` |
| Business Capability Registry / configuração por tenant e unidade | `T02`, `T09` | `[x] Contrato/persistência interna T02 certificados; RBAC de unidade futura` |
| Food Service Pack — operação nativa / painel de produção | `T03`, `T06`, `T07` | `[x] Operação nativa certificada internamente; piloto real T08.4 ainda bloqueado` |
| Food Service Pack — integração por PDV/KDS/delivery | `T03`, `T06`, `T07`, `T08.4` | `[x] Contratos internos T06/T07 certificados; [ ] conector/ACK real somente em T08.4 se selecionado` |
| Scheduling Engine / salão / estética / novos setores | `T09`–`T12` | `[ ] Engenharia futura após gates internos T08.2–T08.4, sem aguardar T08.5 real` |

### 4.2 10 Jornadas Obrigatórias de Aceite do Piloto (Seção 13.2)
- [x] **01. Atendimento:** Responde cardápio, horário e regras cadastradas sem inventar dados (`T02`, `T08.4`).
- [x] **02. Pedido:** Pizza de dois sabores e adicionais calculados corretamente com número único (`T03`, `T08.4`).
- [x] **03. Entrega:** Endereço e taxa validados antes da confirmação; opção de retirada (`T03`, `T06`, `T08.4`).
- [x] **04. Pix:** contrato Pix de teste com payload QR/Copia e Cola de demonstração, webhook assinado mockado e confirmação por GET PSP simulado (`T04`, `T08.2`, `T08.4`).
- [x] **05. Produção:** Liberação única após validação financeira/política (`T06`, `T08.4`).
- [x] **06. Notificação:** avisos simulados baseados somente em estados operacionais persistidos de confirmação, preparo e entrega (`T06`, `T08.4`).
- [x] **07. Financeiro:** Dono autenticado consulta dia/semana/mês com totais reconciliados (`T05`, `T08.4`).
- [x] **08. Exceções:** Expiração, duplicidade, valor divergente, alteração e cancelamento tratados (`T04`, `T07`, `T08.4`).
- [x] **09. Isolamento:** Cliente ou admin de outro tenant não acessa dados da pizzaria (`T01`, `T02`, `T05`, `T08.4`).
- [x] **10. Resiliência:** Falha de IA, webhook repetido, timeout e reinício não duplicam efeitos (`T01`, `T04`, `T06`, `T08.4`).

**Observação:** [x] comprova apenas **aceite interno simulado**, NUNCA aprovação de produção. A jornada J04 usa Pix de demonstração; autenticidade/validade bancária real e escaneamento/baixa são homologação externa independente. As 10 jornadas reais permanecem 0/10 homologadas.

### 4.3 Matriz adicional obrigatória dos dois modos — sem reduzir as 10 jornadas
- [x] **Nativo (interno simulado):** caixa/fila de pedidos própria, alteração de status por papéis autorizados, confirmação de recebimento na entrega e notificação somente após evento persistido.
- [x] **Integrado (contrato interno simulado; alteração/cancelamento inseguro bloqueado e encaminhado à revisão):** pedido único enviado via adapter, ACK/recusa, timeout, reentrega, versão, alteração/cancelamento, status remoto verificado e deduplicação.
- [x] **Modo mutuamente exclusivo (interno simulado):** um só destino de produção por pedido, troca controlada de modo sem migrar pedidos abertos silenciosamente; isolamento por tenant/unidade e permissões.
- [ ] **Piloto real:** homologação do modo escolhido, prova de operação com a proprietária; o modo não escolhido fica desabilitado em produção até homologação própria.

---

## 5. Expansão multissetorial posterior — definição e gates T09–T12

### T09 — Business Capability Registry / módulos plugáveis (`✅ CÓDIGO E TESTES IMPLEMENTADOS — PR #25; CERTIFICAÇÃO PÓS-MERGE EXIGIDA`)
- **Escopo:** manifests e capabilities horizontais tipadas; 6 templates por vertical; atribuições T09 por tenant/unidade com histórico e CAS Firestore, guardas de pedidos em aberto, RBAC, audit trail e rollback como revisão imutável. API e painel administrativo; gate obrigatório nos endpoints alimentares e na autonomia cognitiva. Nenhum dado de estabelecimento é fixado no código.
- **DoD de engenharia interno:** 3 tenants FOOD_SERVICE, RETAIL e BEAUTY com escolhas segregadas e sem vazamento; mais 3 verticais SERVICES, HEALTH_SERVICE e OTHER; versões e dependências, autorizações, concorrência, migração segura, rollback, proteção de runtime e testes HTTP.
- **Evidências de código:** `tests/t09CapabilityFabric.test.ts`, `tests/t09BusinessProfileIsolation.test.ts`, `tests/t09CapabilityHttpGuard.test.ts` e documentação `docs/T09_CAPABILITY_FABRIC_SYSTEM_DESIGN.md`; PR #25 e CI cumulativa registrada na PR. O encerramento formal exige CI do HEAD final e CI da `main` pós-merge verde.
- **Escopo externo:** nenhum produto futuro habilitado; SCHEDULING e packs retail/beauty/health permanecem PLANNED e travados em T10–T12. Homologação da Pizzaria Americana e go-live T08.5 continuam NO_GO, sem impedir a próxima engenharia.

### T10 — Scheduling Engine horizontal (`✅ IMPLEMENTAÇÃO — PR #26; GATE FINAL E PÓS-MERGE EXIGIDOS`)
- **Escopo:** agenda horizontal versionada por tenant/unidade, serviços com duração e sinal opcional, profissionais, recursos, turnos, feriados e bloqueios, disponibilidade IANA/DST; reserva persistida temporária, confirmação segregada, reagendamento/cancelamento atômicos, expiração, conclusão e lembretes internos persistidos.
- **Governança:** disponibilidade sem PII, autorização de capabilities T09, vinculação a cliente ativo do tenant, RBAC e CAS; exclusão mútua de profissional e recurso entre unidades do mesmo tenant por transações Firestore, histórico imutável e recibos de idempotência. A agenda nativa não confirma reservas em modo integrado.
- **Sinal:** contrato Pix opcional com adaptadores verificados por tenant, claim durável antes do PSP, reconciliação por GET com valor e referência exatos, falha incerta para revisão, sem cobrança repetida. Chave de produção dedicada além dos gates T08.3; nenhum PSP real foi operado.
- **DoD:** `tests/t10SchedulingEngine.test.ts`, `tests/t10FirestoreEmulator.test.ts` (emulador Firestore isolado), configuração Docker do worker, CI cumulativa, documentação `docs/T10_SCHEDULING_ENGINE_SYSTEM_DESIGN.md` e certificação final PR #26. Nenhuma confirmação sem reserva persistida.
- **Limite:** lembretes internos prontos sem envio externo; T11 implementará os fluxos especializados/entrega de comunicação, política de sinal e faltas. Nenhuma homologação externa, go-live ou integração de agenda de terceiros foi realizada.

### T11 — Salão/barbearia/estética (`🔒 Até CI pós-merge T10`)
- Perfis de serviço/profissional, seleção de horários, comunicação de confirmação, lembretes, política de sinal, reagendamento e faltas; atuação administrativa em estética, nunca triagem médica autônoma.
- **DoD:** testes E2E dos serviços em 2 segmentos, conflitos de agenda, inadimplência do sinal, sem vazamento entre estabelecimentos, provas de estado e conformidade de canal.

### T12 — Comércio/serviços e onboarding multissetorial (`🔒 Travado em T11`)
- Modelos de entrada por segmento, onboarding comercial, catálogo/carrinho/ordens ou reservas conforme capabilities, relatórios e controle de planos; adapters opcionais, sem dependência rígida de qualquer PDV, agenda ou PSP.
- **DoD:** cobertura cross-pack, configuração sem mudança de código do Core, CI cumulativa integral e aprovação do Diretor.

**Observação:** T09–T12 são trilha de evolução posterior, **não dependências da implantação da Pizzaria Americana**.

---

## 6. Marco de engenharia existente — não confundir com certificação das tarefas

- **21/11/2026 — PR #8** integrada à `main` (`7459e9fd1146851d7990c7a20abc22889006296a`), CI pós-merge `#44897716369` **SUCCESS**: webhooks autenticados de 5 provedores, conciliação e worker; sem mTLS/credenciais/conta real homologadas.
- **21/11/2026 — PR #9** integrada à `main` (`8a365ee76a0767a571088adb2f255659b2dbfe7a`), CI pós-merge `#44900431427` **SUCCESS**: modos de vault no Compose e saúde do worker; sem implantação/ativação na Contabo.
- Essas entregas são **evidência parcial prévia relevante para T04**, mas não certificam o vínculo `Order→Payment`, outbox, estorno, Food Pack ou o DoD integral T04. **T01–T08 mantêm os estados do painel até certificação própria**. Nenhuma tarefa deve ser retroativamente marcada `[x] ENTREGUE` apenas por estas CIs. **Atualização posterior:** a T01 foi certificada integralmente pela PR #11 / CI #44906758883; T02–T08 permanecem bloqueadas por suas travas e autorização do Diretor. Consulte `docs/T01_CLOSURE_CERTIFICATION.md`.
- **Progresso documental desta revisão:** decisão multissetorial e dois modos adicionados ao cronograma. Nenhum código de domínio, ativação bancária, alteração de tenant ou deploy foi executado nesta revisão.

---

## 7. Limites de Escopo (Não Implementar Nesta Evolução)
- Não transformar o AtendeVendeIA em ERP completo, sistema contábil, instituição financeira, Kordena ou Super Core Extreme.
- Não implementar folha de pagamento, compras, estoque avançado ou escrituração contábil.
- Não intermediar fundos pela FM Tecnologia IA (recebimento direto na conta do estabelecimento no PSP contratado).
- Não exigir contratação do NFCore ou do Kordena para operar o AtendeVendeIA.

## 8. Certificação T02 — Registro pós-evolução
- **21/11/2026 — T02 entregue internamente:** PR #12, SHA funcional `5a89a5580ede7e3c45041008808deebf692691d7`, CI `#44917033763` SUCCESS; 226 testes TS, 7 Python, segurança, build e Docker aprovados.
- Evidência detalhada: `docs/T02_CLOSURE_CERTIFICATION.md`, `docs/ADR-003_T02_BUSINESS_KNOWLEDGE_MEMORY.md` e `docs/T02_BUSINESS_PROFILE_RUNBOOK.md`.
- O catálogo existente ainda é tenant-scoped; ajustes por unidade e Food Pack operacional pertencem a T03/T06. Sem deploy/WhatsApp bancário real.
- **T03 permanece bloqueada** até aprovação humana explícita após certificação e revisão de encerramento da T02.


## 9. Certificação T03 — Registro pós-evolução
- **21/11/2026 — T03 certificada internamente:** PR #13, SHA funcional `47bc7e8cd6ec28a9cef8536b0395ca3b430096b5`, CI #44922979257 SUCCESS; 248 testes TypeScript, 7 Python, build/segurança/Docker verdes.
- **Entregue:** Catálogo unitário versionado, pizza meio a meio, tamanhos, bordas, adicionais, bebidas, combos, cupons, disponibilidade, delivery/pickup, ordem atômica, snapshots, idempotência, confirmação e cancelamento governados.
- **Não entregue nesta etapa:** pagamento pedido→PSP (T04); gestão financeira (T05); despacho real/painel/PDV/KDS/geoentrega (T06); ativação WhatsApp e dados reais da Pizzaria (T08).
- **Limite de certificação:** transações Firestore implementadas e avaliadas por doubles determinísticos na CI, sem homologação com Firestore real ou autenticação externa de WhatsApp.
- Evidências: `docs/T03_CLOSURE_CERTIFICATION.md`, `docs/ADR-004_T03_UNIVERSAL_ORDER_ENGINE_FOOD_PACK.md` e `docs/T03_ORDER_ENGINE_RUNBOOK.md`.
- **T04 permanece BLOQUEADA** até autorização humana explícita após certificação e aprovação do bloco.


## 10. Certificação T04 — Fechamento interno

- **21/11/2026:** T04 entregue e certificada internamente via PR #14, SHA funcional 704304eb98635479f168f2a932517772b9ba8db3, CI #44935718242 SUCCESS.
- **Testes:** 269/269 TypeScript em 50 arquivos; 7/7 Python; build, typecheck, security boundaries, Compose config, Docker Node e Python certificados.
- **Entregue:** vínculo transacional pedido/pagamento, Pix, adaptação multibanco existente, COD auditado, governança de refund, webhook autenticado + PSP GET, reconciliação, investigação, outbox com DLQ, eventos financeiros e índices versionados.
- **Não declarar homologado:** PSP/checkout/estorno bancário real, aplicação de índices em Firestore externo, publicação na Contabo/Cloud Run, autenticação real WhatsApp e piloto Pizzaria Americana.
- **Evidência:** docs/T04_CLOSURE_CERTIFICATION.md e docs/ADR-005_T04_ORDER_PAYMENT_ENGINE.md; T04 tem contratos e teste determinístico de PSP, não certificação real de adquirência/sandbox externo.
- **T05 bloqueada** até autorização humana explícita após T04, segundo a trava sequencial.


## 11. Certificação T05 — Gestão Financeira Comercial
- **21/11/2026 — T05 certificada internamente:** PR #15; SHA funcional `49dcae65424c2f579cc650803e6b88aff1c34f9b`; CI integral #44940142925 SUCCESS.
- **Testes:** 289/289 TypeScript em 52 arquivos; 7/7 Python; build, typecheck, segurança e smoke Docker aprovados.
- **Entregue:** ledger determinístico por unidade, vendas brutas/líquidas, recebimentos, estornos, pendentes, descontos, ticket médio, ranking, intervalos dia/semana/mês com timezone do estabelecimento, semana configurável e consultas administrativas IA com RBAC OWNER/ADMIN.
- **Qualidade:** valores financeiros reconstruídos com Orders T03 e outbox T04, verificação de pagamentos e prova, paginação de fontes, rejeição de registros incompletos e proteção contra dados históricos cruzados.
- **Limites explícitos:** cobertura apenas T03/T04 com unitId verificável; cotações legadas sem unitId não atribuídas; taxas PSP ausentes permanecem null; nenhum dado bancário real ou deploy Contabo/Cloud Run homologado; índices Firestore versionados, não aplicados externamente.
- **Evidências:** `docs/T05_CLOSURE_CERTIFICATION.md`, `docs/ADR-006_T05_FINANCE_LEDGER_COGNITIVE_ADMIN.md` e `docs/T05_FINANCIAL_ADMIN_RUNBOOK.md`.
- **T06 permanece BLOQUEADA** até autorização humana explícita pós-certificação T05.
