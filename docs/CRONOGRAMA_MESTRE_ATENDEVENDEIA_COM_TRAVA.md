# ATENDEVENDEIA — COGNITIVE COMMERCE PLATFORM
## Cronograma Mestre de Execução com Trava Sequencial e Controle de Entregas

**Organização:** FM Tecnologia IA  
**Repositório de destino:** `faabio3131/ai-sales-saas-vendedor-ia`  
**Documento de referência:** `ATENDEVENDEIA_ARQUITETURA_MESTRE_COGNITIVE_CORE_V1.md` (v1.0 — 20/11/2026)  
**Projeto-piloto:** Pizzaria Americana  
**Autoridade final:** Diretor/Proprietário da FM Tecnologia IA  
**Revisão documental:** v1.1 — 21/11/2026  
**Decisão confirmada:** núcleo comercial universal + especialização alimentar prioritária + dois modos operacionais por estabelecimento/unidade.  
**Status deste aditivo:** ESCOPO E CRONOGRAMA APROVADOS CONCEITUALMENTE PELO DIRETOR; implementação sujeita às travas abaixo, sem autorização automática de deploy ou avanço de tarefa.  

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
- **Depois do piloto alimentar**, estudar e implementar um **Scheduling Engine horizontal** (disponibilidade, agenda, profissionais/recursos, duração, bloqueio transacional de horário, reservas, remarcação, cancelamento, lembretes e sinal de pagamento). Adapters configuráveis atenderão **salões/barbearias** e **clínicas de estética**. Agendamento não é sinônimo de pedido; preservar invariantes e contratos próprios.
- Em estética, o escopo inicial será **atendimento administrativo, agendamento e comercial**. Não fornecer triagem/diagnóstico médico ou recomendações clínicas autônomas; informações sensíveis exigem proteção e autorização específicas.
- Expansões para lojas e serviços serão novos capability packs, sem reescrever tenancy, pagamento, memória ou IA; **T09+ ficam travadas até T08.5**.
- O planejamento multissetorial não transforma este trabalho em ERP, prontuário, RH, estoque avançado, sistemas contábeis ou produção de cozinha do Kordena.

### 0.3 Critério de prioridade de implantação

1. **Agora:** engenharia integral do Food Service Pack e a jornada fechada da Pizzaria Americana, seguindo T01→T07.
2. **Nesta semana de preparação com a cliente:** é permitido **levantar e validar dados reais** (cardápio, regras de pizza, modalidades de pagamento, bairros, valores, horários, perfis, modo nativo/integrado), em documento de coleta **sem ativar contas, conexões ou a produção**. Essa coleta não conclui nem destrava T08.1.
3. **Após T07 certificado:** executar T08.1→T08.5, homologar o modo escolhido com a proprietária, realizar piloto e aprovar o go-live.
4. **Após piloto aprovado:** executar T09+ de expansão multissetorial, mediante autorização específica do Diretor.

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
- **Trilha 2 (`T08.1` a `T08.5` — Piloto Pizzaria Americana & Go-Live):** Permanece **`🔒 BLOQUEADA`** até a certificação integral da **`T07`**. Apenas levantamento preliminar de dados da loja, sem ativação, pode ocorrer em paralelo.
- **Trilha 3 (`T09` a `T12` — Expansão multissetorial):** Permanece **`🔒 BLOQUEADA`** até certificação da **`T08.5`** e autorização expressa; não pode atrasar ou contaminar o piloto alimentar.

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
| **T01** | `🔓 LIBERADO` | Integração Cognitiva (ADR-001/002: FM Core Base + Padrões NFCore + Adaptador TS) | 7d | `[ ] PENDENTE` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T02** | `🔒 Finalize T01` | Conhecimento e Memória por Estabelecimento (Tenant) | 5d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T03** | `🔒 Finalize T02` | Catálogo e Order Engine universais + Food Pack (cardápio e regras alimentares) | 7d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T04** | `🔒 Finalize T03` | Payment Engine (Pix Dinâmico, Checkout, Webhooks e Reconciliação) | 8d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T05** | `🔒 Finalize T04` | Gestão Financeira Comercial e Consultas Administrativas IA | 6d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T06** | `🔒 Finalize T05` | Food Service Pack — delivery, produção e 2 modos (nativo/integrado) | 6d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T07** | `🔒 Finalize T06` | Autonomia Operacional Governada e Resolução de Exceções | 6d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |

### Trilha 2 — T08: Piloto Pizzaria Americana & Habilitação Externa (Pós-T07)

| ID | Gate / Trava | Etapa do Piloto e Certificação Externa | Prazo Est. | Status | Data Entrega | Evidência (Runbook / Logs / Aprovação) |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- |
| **T08.1** | `🔒 Finalize T07` | Cadastro real da pizzaria, validação e escolha de modo operacional | 3d | `[ ] BLOQUEADO` | `__/__/____` | `Validação Proprietária ___` |
| **T08.2** | `🔒 Finalize T08.1` | Credenciais Externas Isoladas (Conta PSP Pix + WhatsApp Oficial) | 3d | `[ ] BLOQUEADO` | `__/__/____` | `Cofre / Teste Pix Real ___` |
| **T08.3** | `🔒 Finalize T08.2` | Deploy Contabo, Feature Flag do Piloto, Backup e Rollback | 3d | `[ ] BLOQUEADO` | `__/__/____` | `Healthcheck / Rollback ___` |
| **T08.4** | `🔒 Finalize T08.3` | Certificação E2E das 10 jornadas + modo escolhido e testes dos 2 contratos | 4d | `[ ] BLOQUEADO` | `__/__/____` | `Relatório 10/10 Jornadas ___` |
| **T08.5** | `🔒 Finalize T08.4` | Aprovação Final do Diretor e Go-Live Controlado do Piloto | 2d | `[ ] BLOQUEADO` | `__/__/____` | `Autorização Formal ___` |

### Trilha 3 — Expansão Horizontal e Agendamentos (Pós-piloto, sem antecipar T08)

| ID | Gate / Trava | Entrega Funcional Consolidada | Prazo Est. | Status | Data Entrega | Evidência (PR / SHA / CI Run) |
| :--- | :---: | :--- | :---: | :---: | :---: | :--- |
| **T09** | `🔒 Finalize T08.5` | Business Capability Registry evoluído, contratos dos packs e configuração multissetorial | 5d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T10** | `🔒 Finalize T09` | Scheduling Engine horizontal — agenda, disponibilidade, reserva atômica, reagendamento e lembretes | 8d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T11** | `🔒 Finalize T10` | Service Booking Packs — salão, barbearia e clínica de estética (escopo administrativo) | 7d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |
| **T12** | `🔒 Finalize T11` | Templates de comércio/serviços, onboarding por capabilities e certificação multissetorial | 6d | `[ ] BLOQUEADO` | `__/__/____` | `PR #___ / SHA ___ / CI ___` |

> Os prazos são **estimativas de esforço, não datas prometidas**. Não desdobrar T09–T12 em implementação antes de T08.5. A validação de contratos universais mínimos pode ocorrer em T01–T07 apenas quando necessária ao Food Pack, sem antecipar o domínio de agenda.

---

## 3. Detalhamento Técnico e Critérios de Aceite (DoD)

### T01 — Integração Cognitiva (`🔓 LIBERADO`)
- **Escopo:** Auditar SHAs e inventário dos 3 repositórios (`FM-Core-Base-`, `cognitivo-nfcore-inteligencia-fiscal`, `ai-sales-saas-vendedor-ia`); reconciliar drift com runtime; formalizar ADR-002 (serviço cognitivo Python interno + adaptador TypeScript preservando `AIRouterInterface`, sem escrita direta no banco comercial); integrar roteamento, Context Pack Builder, Output Guard, proveniência, redaction, resiliência (deadline, circuit breaker, bulkhead, fallback) e FinOps.
- **Critério de Aceite (DoD):**
  - [ ] Jornada comercial existente exercita a fundação cognitiva de ponta a ponta.
  - [ ] Saída estruturada validada, timeout/fallback, isolamento de tenant e segurança testados.
  - [ ] Build, typecheck, suíte cumulativa e smoke runtime aprovados no mesmo HEAD.
  - [ ] Contratos simulados registrados separadamente de credenciais reais de provedor.

### T02 — Conhecimento e Memória por Estabelecimento (`🔒 Travado em T01`)
- **Escopo:** Definir e validar o `BusinessCapabilityRegistry` mínimo por tenant/unidade (`FOOD_SERVICE`, `ORDERING`, `PRODUCTION`, `DELIVERY`, `OPERATION_MODE`, flags versionadas) como contrato horizontal reutilizável; não implementar o Scheduling Engine nesta tarefa. Implementar `BusinessKnowledge` e `PolicyProfile` versionados com vigência; catálogo e regras como fontes de verdade; `Memory Layer` com histórico, preferências e retenção configurável por cliente/tenant; identidade configurável da atendente; tratamento de lacunas e contradições.
- **Critério de Aceite (DoD):**
  - [ ] Dois tenants distintos configurados com cardápios e políticas diferentes, zero vazamento cruzado.
  - [ ] Respostas fundamentadas em evidências reais, sem invenção de preços ou horários.
  - [ ] Alterações respeitam versão e vigência; memória persistida e governada.
  - [ ] O perfil de negócio e o modo operacional são persistidos e versionados por tenant/unidade, com alteração autorizada, fail-closed e teste de isolamento. Nenhum nicho é hardcoded no Core.

### T03 — Motor de Pedidos e Regras Comerciais (`🔒 Travado em T02`)
- **Escopo:** Completar `Catalog Engine` (produtos, variantes, tamanhos, bordas, adicionais, combos, múltiplos sabores e regra configurável de meio a meio) e `Order Engine` (valores em centavos inteiros BRL, snapshot imutável do catálogo, numeração atômica única por tenant/unidade, separação das dimensões Pedido/Pagamento/Entrega e cotação básica de entrega).
- **Critério de Aceite (DoD):**
  - [ ] Jornada completa de pedido repetível com cálculo determinístico exato.
  - [ ] Concorrência na numeração, idempotência, alteração, cancelamento e titularidade testados.
  - [ ] Nenhuma cobrança criada antes da confirmação explícita do cliente.
  - [ ] O `Order Engine` é horizontal e independente de PDV, cozinha e plataforma de pagamento; contrato de despacho aceita ambos os modos sem executar despacho nesta tarefa.
  - [ ] Casos alimentares cobertos: meio a meio, múltiplos tamanhos, bordas, adicionais, bebidas, combos, promoções, disponibilidade, opção retirada/delivery, snapshot e taxa configurável.

### T04 — Payment Engine (`🔒 Travado em T03`)
- **Escopo:** Implementar `PaymentProviderPort` com adapters candidatos (Mercado Pago, PagBank, Asaas) em sandbox/contrato; Pix dinâmico (QR Code + Copia e Cola + expiração), checkout seguro de cartão (sem armazenar PAN), dinheiro na entrega e troco; webhook autenticado com validação de assinatura, valor, moeda, conta beneficiária e deduplicação; outbox transacional, reconciliação em worker com backoff/DLQ, estorno governado; atualizar `PolicyEngine` para autorizar `CREATE_PAYMENT` apenas sobre pedido confirmado; lançamentos financeiros mínimos para T05.
- **Critério de Aceite (DoD):**
  - [ ] Testes contratuais/sandbox por adapter e integração pedido-pagamento aprovados.
  - [ ] Exceções cobertas: timeout, Pix expirado, pagamento tardio, webhook duplicado/fora de ordem, valor divergente e estorno.
  - [ ] Zero confirmação de pagamento baseada em texto, print ou confiança do LLM.
  - [ ] Confirmação financeira/eventos duráveis não são confundidos com preparo ou entrega; dinheiro/cartão na entrega seguem confirmação operacional auditada, com papel e ator identificados.
  - [ ] Reconciliar a base já implementada (PR #8 e #9, 21/11/2026) sem reimplementar adapters: faltas de outbox, vínculo pedido/pagamento e emissão de eventos são auditadas e só recebem status DONE quando certificadas.

### T05 — Gestão Financeira Comercial e Consultas Cognitivas (`🔒 Travado em T04`)
- **Escopo:** Consolidar ledger comercial e projeções reconstruíveis; congelar definições de vendas brutas, vendas líquidas, recebimentos confirmados, recebimentos líquidos, pendentes, taxas, estornos, ticket médio e ranking de produtos; timezone do estabelecimento (`America/Sao_Paulo`), intervalos semiabertos e semana configurável; painel administrativo e consulta em linguagem natural autenticada via RBAC.
- **Critério de Aceite (DoD):**
  - [ ] Totais reconciliam 100% contra transações conhecidas (dia, semana e mês).
  - [ ] Bloqueio estrito de consultas administrativas em conversa pública ou sem RBAC válido.
  - [ ] Separação clara entre receita do estabelecimento e métricas/custos de IA da FM.

### T06 — Delivery, Produção e Acompanhamento (`🔒 Travado em T05`)
- **Escopo:** Implementar e certificar o **Food Service Pack com dois modos mutuamente exclusivos por estabelecimento/unidade**: `NATIVE_OPERATIONS` usa painel próprio de produção/fila/retirada/entrega; `INTEGRATED_OPERATIONS` usa adapter homologável de PDV/KDS/delivery existente, sem duplicar as operações. Construir contrato `ProductionDispatchPort` com ACK real, correlação, idempotência, outbox/inbox, retries/backoff/DLQ e fonte de verdade explícita dos estados. Proibir mudança silenciosa de modo durante pedido ativo. Completar `Delivery Engine` (validação de endereço/CEP, área atendida, regras de taxa, retirada, janela estimada fundamentada); painel/adapter operacional de produção, fila de despacho e eventos duráveis (`OrderReleasedToProduction`, `OrderReady`, `DeliveryDispatched`, `DeliveryCompleted`); notificações reais ao cliente baseadas no estado persistido.
- **Critério de Aceite (DoD):**
  - [ ] Entrega normal, retirada e endereço fora da área testados.
  - [ ] Liberação única à produção condicionada a pagamento confirmado ou modalidade autorizada.
  - [ ] Reprocessamento e falhas não duplicam pedido na cozinha; zero promessa de GPS sem fonte real.
  - [ ] Modo nativo: painel autoriza papéis operacionais, acompanha estados reais e informa o cliente somente após persistência.
  - [ ] Modo integrado: contrato testado para ACK, idempotência, payloads, versionamento, deduplicação e estados externos; indisponível sem conector homologado, com fallback humano explicitamente governado.
  - [ ] Ambos os modos possuem suíte interna de contrato/E2E; somente um destino de produção ativo por pedido e nenhum cross-tenant/unidade; integração externa real pertence ao T08 quando adotada pela pizzaria.

### T07 — Autonomia Operacional Governada e Exceções (`🔒 Travado em T06`)
- **Escopo:** Formalizar modos `ASSIST`, `COPILOT` e `AUTONOMOUS_GOVERNED`; Tool Gateway com allowlist estrita e recibos auditáveis; workflow formal de aprovação humana vinculada a escopo/valor/validade; integração com recuperação de vendas (respeitando consentimento/opt-out); bateria adversarial e de permissões.
- **Critério de Aceite (DoD):**
  - [ ] Pedidos rotineiros completam o fluxo sem intervenção humana respeitando confirmação e evidências.
  - [ ] Casos de risco (alergias sem dado, disputa financeira, desconto fora de política, prompt injection) são bloqueados/escalados.
  - [ ] Nenhuma elevação autônoma de privilégio; suíte cumulativa E2E interna 100% verde.
  - [ ] Fluxo do WhatsApp fechado: proposta → confirmação explícita → pedido/cobrança → operação selecionada → notificações por estado real → pós-venda conforme consentimento; controle de duplicidade e retry em cada transição.
  - [ ] Testes adversariais impedem IA de trocar `OPERATION_MODE`, autorizar integração externa inexistente, fabricar status ou acessar finanças sem RBAC.

### T08 — Piloto Pizzaria Americana (`🔒 Travado em T07`)
- **T08.1:** Cadastro real validado pela proprietária (nome da atendente, cardápio, regra meio a meio, horários, taxas, perfis) e **escolha explícita do modo** `NATIVE_OPERATIONS` ou `INTEGRATED_OPERATIONS`, com registro da decisão por tenant/unidade. A coleta preliminar nesta semana não destrava este gate.
- **T08.2:** Configuração de conta habilitada no PSP Pix no cofre isolado + canal WhatsApp autorizado e webhook HTTPS.
- **T08.3:** Inspecionar a topologia real antes do deploy: há registro anterior de backend no Google Cloud Run e worker preparado para Contabo; escolher/preservar o destino efetivo mediante aprovação sem migração presumida. Deploy isolado, feature flag do piloto, versão certificada de API/worker, vault compatível, backup testado e rollback.
- **T08.4:** Certificação evidenciada das **10 Jornadas Obrigatórias de Aceite** (Atendimento, Pedido, Entrega, Pix, Produção, Notificação, Financeiro, Exceções, Isolamento e Resiliência) no **modo escolhido**. Verificação documental dos testes de contrato de ambos os modos. Se o modo for integrado, exigir homologação real do PDV/KDS escolhido antes do aceite; caso nativo, não inventar integração externa.
- **T08.5:** Manual operacional, reconciliação diária, relatório final com evidências e autorização formal de Go-Live pelo Diretor.

---

## 4. Matriz de Cobertura 100%

### 4.1 Motores e Componentes Arquiteturais
| Componente | Tarefa Responsável | Cobertura |
| :--- | :---: | :---: |
| Commercial Cognitive Core (Router, Context Pack, Output Guard, Resilience, FinOps) | `T01`, `T07` | `[ ] DoD da evolução não certificado` |
| Business Knowledge & Memory Layer (Multi-tenant) | `T02` | `[ ] DoD da evolução não certificado` |
| Catalog Engine & Order Engine | `T03` | `[ ] DoD da evolução não certificado` |
| Payment Engine (Pix Dinâmico, Checkout, Webhooks, Reconciliação) | `T04` | `[ ] DoD da evolução não certificado` |
| Financial Engine & Admin Cognitive Queries | `T05` | `[ ] DoD da evolução não certificado` |
| Delivery, Production & Notification Engine | `T06` | `[ ] DoD da evolução não certificado` |
| Customer, Sales, Recovery & Autonomous Governance | `T01`, `T02`, `T07` | `[ ] DoD da evolução não certificado` |
| Business Capability Registry / configuração por tenant e unidade | `T02`, `T09` | `[ ] Não certificado para a evolução` |
| Food Service Pack — operação nativa / painel de produção | `T03`, `T06`, `T07` | `[ ] Não certificado para a evolução` |
| Food Service Pack — integração por PDV/KDS/delivery | `T03`, `T06`, `T07`, `T08.4` | `[ ] Contratos e runtime real não homologados` |
| Scheduling Engine / salão / estética / novos setores | `T09`–`T12` | `[ ] Futuro — BLOQUEADO até T08.5` |

### 4.2 10 Jornadas Obrigatórias de Aceite do Piloto (Seção 13.2)
- [ ] **01. Atendimento:** Responde cardápio, horário e regras cadastradas sem inventar dados (`T02`, `T08.4`).
- [ ] **02. Pedido:** Pizza de dois sabores e adicionais calculados corretamente com número único (`T03`, `T08.4`).
- [ ] **03. Entrega:** Endereço e taxa validados antes da confirmação; opção de retirada (`T03`, `T06`, `T08.4`).
- [ ] **04. Pix:** QR Code e Copia e Cola válidos com confirmação oficial via webhook (`T04`, `T08.2`, `T08.4`).
- [ ] **05. Produção:** Liberação única após validação financeira/política (`T06`, `T08.4`).
- [ ] **06. Notificação:** Cliente recebe status real de confirmação, preparo e entrega (`T06`, `T08.4`).
- [ ] **07. Financeiro:** Dono autenticado consulta dia/semana/mês com totais reconciliados (`T05`, `T08.4`).
- [ ] **08. Exceções:** Expiração, duplicidade, valor divergente, alteração e cancelamento tratados (`T04`, `T07`, `T08.4`).
- [ ] **09. Isolamento:** Cliente ou admin de outro tenant não acessa dados da pizzaria (`T01`, `T02`, `T05`, `T08.4`).
- [ ] **10. Resiliência:** Falha de IA, webhook repetido, timeout e reinício não duplicam efeitos (`T01`, `T04`, `T06`, `T08.4`).

### 4.3 Matriz adicional obrigatória dos dois modos — sem reduzir as 10 jornadas
- [ ] **Nativo:** caixa/fila de pedidos própria, alteração de status por papéis autorizados, confirmação de recebimento na entrega e notificação somente após evento persistido.
- [ ] **Integrado (contrato interno):** pedido único enviado via adapter, ACK/recusa, timeout, reentrega, versão, alteração/cancelamento, status remoto verificado e deduplicação.
- [ ] **Modo mutuamente exclusivo:** um só destino de produção por pedido, troca controlada de modo sem migrar pedidos abertos silenciosamente; isolamento por tenant/unidade e permissões.
- [ ] **Piloto real:** homologação do modo escolhido, prova de operação com a proprietária; o modo não escolhido fica desabilitado em produção até homologação própria.

---

## 5. Expansão multissetorial posterior — definição e gates T09–T12

### T09 — Business Capability Registry / módulo plugável (`🔒 Travado em T08.5`)
- Formalizar contratos de capacidades reutilizáveis e ativação por tenant/unidade; catálogo de templates por segmento, migração/configuração segura, isolamento e rollback.
- **DoD:** 3 tenants de segmentos distintos sem vazamento, autorização e seleção de capabilities; nenhum domínio especializado contamina o núcleo.

### T10 — Scheduling Engine horizontal (`🔒 Travado em T09`)
- Agenda, serviços com duração, profissionais, unidades, recursos, turnos, disponibilidade, reserva atômica, confirmação, reagendamento/cancelamento, lembrete e integração opcional a pagamento de sinal.
- **DoD:** teste de corrida de horários, timezones, feriados, recursos bloqueados, cancelamento/replay e privacidade. Nenhuma confirmação de horário sem reserva persistida.

### T11 — Salão/barbearia/estética (`🔒 Travado em T10`)
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
- Essas entregas são **evidência parcial prévia relevante para T04**, mas não certificam o vínculo `Order→Payment`, outbox, estorno, Food Pack ou o DoD integral T04. **T01–T08 mantêm os estados do painel até certificação própria**. Nenhuma tarefa deve ser retroativamente marcada `[x] ENTREGUE` apenas por estas CIs.
- **Progresso documental desta revisão:** decisão multissetorial e dois modos adicionados ao cronograma. Nenhum código de domínio, ativação bancária, alteração de tenant ou deploy foi executado nesta revisão.

---

## 7. Limites de Escopo (Não Implementar Nesta Evolução)
- Não transformar o AtendeVendeIA em ERP completo, sistema contábil, instituição financeira, Kordena ou Super Core Extreme.
- Não implementar folha de pagamento, compras, estoque avançado ou escrituração contábil.
- Não intermediar fundos pela FM Tecnologia IA (recebimento direto na conta do estabelecimento no PSP contratado).
- Não exigir contratação do NFCore ou do Kordena para operar o AtendeVendeIA.