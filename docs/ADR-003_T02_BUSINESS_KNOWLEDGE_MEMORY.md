# ADR-003 — Business Knowledge & Scoped Memory (T02)

**Decisão de engenharia:** 21/11/2026 • **Escopo:** bloco T02 do Cronograma Mestre v1.1 • **Repositório canônico:** AtendeVendeIA.
**Autoridade:** aprovação do Diretor para executar T02; T03 permanece bloqueada até certificação T02 e autorização.

## 1. Decisão
O AtendeVendeIA possui um **núcleo de atendimento universal**, sem regras de pizzaria hardcoded. Uma unidade (tenantId + unitId) mantém revisões independentes de:
- `BusinessIdentity`: nome/estilo da atendente, configuráveis por empresa/unidade.
- `BusinessCapabilityRegistry`: vertical, capabilities `FOOD_SERVICE`, `ORDERING`, `PRODUCTION`, `DELIVERY`, e modo `NATIVE_OPERATIONS` ou `INTEGRATED_OPERATIONS`.
- `PolicyProfile`: timezone, locale, retenção entre 1 e 365 dias, política `DENY` para memória por padrão e obrigatoriedade de evidências.
- `BusinessKnowledge`: entradas aprovadas pela administração com pergunta, resposta, fonte e ID; revisão versionada e vigência `effectiveFrom` / `expiresAt`.

**Selecionar INTEGRATED_OPERATIONS não habilita integração nem prova que um PDV ou KDS está homologado.** A flag `integrationStatus: NOT_CONFIGURED` impede essa inferência; adaptadores operacionais pertencem à T06.

## 2. Imutabilidade, concorrência e vigência
- Cada revisão é salva uma única vez em `businessProfiles/{sha256([tenant,unit])}/versions/{version}`. O documento-pai contém o ponteiro para a última versão.
- Uma transação Firestore valida o `expectedVersion` (CAS) e cria revisão + atualiza ponteiro atomicamente; gravações obsoletas falham.
- A nova vigência não pode retroceder em relação à revisão anterior. A consulta efetiva escolhe a última revisão cujo início já ocorreu. Uma revisão expirada **não reativa automaticamente regras anteriores**.
- A validade de um fato é vinculada à validade de sua revisão; não há edição destrutiva de histórico.
- A identidade `createdBy` deriva do `TenantContext` autenticado, nunca do payload; somente `OWNER`/`ADMIN` podem alterar perfis.

## 3. Grounding de atendimento
- `BusinessGroundingService` responde **somente** com fatos aprovados e vigentes ou preços da coleção canônica `catalogItems` do próprio tenant.
- Preços, descontos e taxas nunca são aceitos como texto livre de FAQ; cálculos comerciais continuam nos motores determinísticos.
- Sem evidência => `UNKNOWN`. Preço ambíguo ou pergunta contraditória => `CONFLICT`. Nenhum desses casos autoriza o LLM a preencher lacunas.
- O pacote para o T01 é formado por `CommercialEvidence` com IDs, tenant, unidade e origem verificável. O builder T01 bloqueia evidência cruzada e mascara segredos.
- **Limitação herdada identificada:** o catálogo BLK-040 é escopado por tenant, **não por unidade**. T02 comprova isolamento de dois tenants e perfis por unidade; o vínculo de itens/variantes por unidade pertence à evolução do Catálogo/Order Engine T03. Não afirmar isolamento de catálogo entre duas unidades do mesmo tenant.

## 4. Memória governada (nova coleção)
- `scopedCustomerMemories/{sha256([tenant,unit,customer])}` armazena apenas memória individual com escopo completo; não mistura dados entre unidades.
- **Consentimento por padrão negado.** A aprovação exige referência a uma mensagem `CUSTOMER/INBOUND/TEXT` da conversa do próprio cliente/tenant, com frase explícita de autorização de memória comercial. Mensagem de IA, outro cliente ou outra empresa é recusada.
- Proveniência das preferências exige referências a mensagens reais da mesma conversa/cliente/tenant; sem isso, a escrita falha.
- Retenção em dias vem da versão vigente do perfil; leitura expirada retorna `null`, mesmo antes da limpeza física. O job `purge:business-memory` remove dados expirados por transação, com limites e logs sem PII.
- Revogação apaga resumo e listas imediatamente e impede leitura do conteúdo. Exclusão definitiva é suportada, com CAS.
- A saída `CommercialCustomerContextService` inclui preferências do cliente no **campo de entrada não confiável** do T01, somente se houver consentimento vigente. Evidências empresariais aprovadas permanecem em `trustedFacts`; nenhuma frase originada do cliente pode ascender a instrução confiável.
- A coleção legada `customerMemories` do CRM BLK-050 **não é usada como fonte para a cognição T02**. É uma função CRM anterior, sem políticas novas por unidade. Não migrar automaticamente os dados nem presumir consentimento retroativo. A migração/limpeza de históricos anteriores exige autorização e avaliação de retenção.

## 5. Segurança, identidade e limites de operação
- Rotas em `/api/business` herdam `authenticationMiddleware` e `tenantAuthorizationMiddleware`. Leituras administrativas e ações sobre memória exigem OWNER/ADMIN; configuração de perfil também.
- O escopo por unidade é segregado nas chaves/dados, mas **a autorização existente é por tenant**. Não afirmar que existe RBAC por unidade antes de implementar memberships de unidade; membros administradores do tenant administram todas as unidades.
- O verificador usa mensagens persistidas como evidência. A autenticação real do remetente de WhatsApp/WebChat e a proteção do canal continuam gates independentes T08; conteúdo que um operador possa inserir não comprova, isoladamente, identidade externa.
- O T02 não envia mensagem externa automaticamente nem cria reservas, pagamentos ou pedidos; o fluxo real de cliente é fechado nas próximas tarefas.
- Não persistir prompt completo, API token ou CPF/telefone em ContextPacks. O contexto é reduzido às evidências autorizadas.

## 6. Plano de teste
Testes cumulativos do domínio, dois tenants com políticas e preços distintos, vigências e versões concorrentes, rejeição de contradição e preço não fundamentado, proteção de perfil por RBAC, memória sem consentimento, consentimento falso, memória cruzada, revogação, retenção, limpeza e montagem do contexto cognitivo T01. Build/typecheck/testes/segurança/Docker obrigatórios no HEAD, sem silenciar verificações.
