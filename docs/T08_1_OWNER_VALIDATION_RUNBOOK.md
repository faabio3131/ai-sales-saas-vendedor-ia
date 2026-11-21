# T08.1 — Cadastro proprietário real e escolha exclusiva do modo

**Situação da entrega:** motor de coleta e certificação interna implementado; **validação proprietária real ainda não efetuada**.  
**Critério de saída de T08.1:** uma proprietária autenticada no tenant correto deve conferir dados operacionais e catálogo publicado e registrar um aceite imutável. Este documento **não atesta** que ela já fez isso.

## Evidência disponível, sem falsificação

O material do usuário de 20/11/2026 foi preservado integralmente em:
- `docs/pilot/PIZZARIA_AMERICANA_BASE_CONHECIMENTO_PRELIMINAR.md`;
- `docs/pilot/pizzaria-americana.t08-1-preliminary.json`.

A origem contém **58 pizzas numeradas** (a Siciliana é nº 61; 58–60 não constam do original), ingredientes descritos e **5 combos de esfiha**, com preços anunciados de R$ 36,00, R$ 56,00, R$ 80,00, R$ 67,00 e R$ 115,00. Esses preços e todos os ingredientes precisam de conferência pela proprietária: **o arquivo não é catálogo de vendas ativado** e não prova ausência de alérgenos.

Dados de identificação fornecidos:
- Nome informado: Pizzaria Americana.
- Endereço parcial: Avenida dos Juritis, 146.
- WhatsApp informado: +55 11 97569-1385.
- Segundo telefone impresso: +55 11 99849-5454, ainda não confirmado como ativo.

Ainda faltam município, bairro, CEP, titularidade vinculada ao usuário OWNER do tenant real, nome escolhido da atendente, horários semanais, receita/preço válido por tamanho, regra de pizza meio a meio, preços vigentes dos combos, entrega por faixa de CEP, taxas e prazos, meios de pagamento, equipe operacional e decisão do modo. Nenhum CNPJ encontrado em busca aberta pode ser atribuído à pizzaria sem correspondência inequívoca e verificação da proprietária. Não presumir que ela está em Americana/SP ou em Praia Grande/SP pelo nome.

## Engenharia entregue

`src/pilot/onboarding/*` usa um **documento por par tenant/unidade** com chave SHA-256 e snapshots versionados imutáveis no Firestore, comparando versão esperada em transação (CAS). O painel em `src/ui/PilotOnboardingPanel.tsx` aparece exclusivamente para membership **OWNER** autenticada. A API está sob cookie de sessão e membership real:
- `GET /api/pilot/units/:unitId/onboarding` — relatório de lacunas e versão atual.
- `PUT /api/pilot/units/:unitId/onboarding/draft` — dados e histórico, sem ativar vendas ou atualizar catálogo.
- `POST /api/pilot/units/:unitId/onboarding/mode` — escolha **explícita da proprietária**, motivo e nome do sistema existente quando o modo for integrado; nunca ativa conector ou muda automaticamente o perfil T02.
- `POST /api/pilot/units/:unitId/onboarding/attest` — aceite somente de OWNER autenticado, com `expectedVersion`, declaração exata e referência de aprovação/documento. A aprovação amarra hash integral dos dados e da decisão, versão efetiva do catálogo T03 e versão do perfil T02; mudanças revogam a prontidão.

### Dependências verificadas no aceite

1. Dados cadastrais completos, município/UF/CEP e WhatsApp com DDI/DDD; nome de persona configurável pelo cliente.
2. Horários com estado de todos os sete dias.
3. `menu.catalogVersion` igual à revisão T03 existente; quantidade exata de sabores de pizza e combos ativos; preços positivos por tamanho e itens; regra meio a meio consistente com todas as pizzas; revisão de ingredientes/alérgenos declarada.
4. Retirada e/ou entrega, previsão operacional, cobertura por CEP e taxas equivalentes ao catálogo publicado.
5. Preferências de pagamentos coletadas **sem criar cobrança nem ativar Pix**.
6. Papéis planejados, sem criar memberships silenciosamente; acesso administrativo depende do tenant.
7. Escolha de `NATIVE_OPERATIONS` ou `INTEGRATED_OPERATIONS` explícita, coerente com o perfil T02. A integração externa **continua sem conector instalado** até T08.4; o modo nativo também exige settings T06 adequados antes da operação.
8. Aprovação vinculada a usuário OWNER, versão e dados vigentes. Referência documental registrada é **declarada**: não é verificação jurídica independente de identidade nem substitui a checagem real da proprietária.

### Limitação conhecida do T03 resolvida

O `src/commerce/service.ts` permitia apenas 40 sabores por item PIZZA. O limite passa a **100 sabores** (mantendo dois sabores máximos por pedido), para comportar os 58 sabores do cardápio sem truncamento, e com teste de regressão dedicado.

### Trava de produção e segurança

- Apenas dados **reais, conferidos e publicados nas fontes canônicas** podem atingir `OWNER_ATTESTED`; não existe autoaceite de um arquivo preliminar ou sinal derivado de IA.
- Nenhum tenant ID, conta OWNER, CPF/CNPJ, endereço completo, CEP, telefone verificado, senha, segredo de PSP, canal WhatsApp, equipe ou escolha de modo é gerado artificialmente.
- Não publicar o arquivo de receitas em catálogo de vendas, não ativar promoção expirada, não declarar isenção de alérgenos e não inventar preço de pizza. Os combos têm preços impressos **não homologados**.
- O antigo readiness estrutural deixa de promover `GO` só com credenciais de ambiente: T08.1 aceite + T08.3 deploy/rollback + T08.4 dez jornadas reais + T08.5 autorização do Diretor são necessários.
- T08.2, T08.3, T08.4 e T08.5 continuam **NO_GO** até seus respectivos gates, sem ativação de provedores ou produção.

## Procedimento para finalizar o cadastro real

1. Confirmar a identificação real do tenant/unidade e a membership autenticada `OWNER` da proprietária. Não criar usuário ou associação sem identidade comprovada.
2. Abrir o painel **Cadastro real do estabelecimento — T08.1** no workspace da empresa correta. Usar os dados recuperados somente como pré-cadastro; solicitar conferência, especialmente cidade e endereço.
3. Completar os sete dias, regras de pizza e cobrança de meio a meio, tamanhos e preços válidos, combos, CEP/taxas, modalidades de entrega, meios de pagamento e papéis.
4. Publicar perfil T02 e catálogo T03 versionados pelos endpoints governados existentes, com os dados conferidos, sem inventar defaults. O cadastro T08.1 referencia essas versões **vigentes** (não apenas futuras ou expiradas), não cria promoções ou pagamentos.
5. A proprietária escolhe **explicitamente** o modo: painel interno nativo para operação sem PDV ou integração quando usa sistema externo. No integrado, informar nome do PDV/KDS e aguardar homologação em T08.4.
6. Conferir todos os checks `READY` exceto `OWNER_SIGNOFF`. Proprietária autenticada registra o documento/aceite real, repete a declaração e assina a revisão. O sistema armazena evidência e passa para `OWNER_ATTESTED` somente se os dados forem consistentes.
7. Conferir a prontidão novamente. O estado do onboarding pode ser `OWNER_ATTESTED`, **mas** `operationalActivationAllowed` permanece **false**. Só a autorização específica do Diretor pode liberar trabalho de T08.2.

**Certificação interna e evidências de CI:** `docs/T08_1_ENGINEERING_CERTIFICATION.md`.
