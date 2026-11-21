# Cadastro de estabelecimentos — configuração multiempresa e validação externa T08.1

## Separação fundamental

**Software:** motor horizontal e interfaces genéricas que armazenam uma configuração distinta para cada par `tenantId`/`unitId` no Firestore. O código-fonte nunca deve conter endereço, telefone, CEP, cardápio, Pix ou credenciais operacionais de clientes específicos.

**Dados do cliente:** alimentados e revisados pelo proprietário autenticado no painel **Configurações do estabelecimento**; salvos em revisões versionadas no banco de dados do cliente. O cadastro pode permanecer em `DRAFT` e ser editado sem aprovação externa ou sistema financeiro ativo. Não inferir preço, estoque ou alérgenos de um arquivo informal.

**Validação externa:** confirmação da proprietária da Pizzaria Americana sobre dados e modo, credenciais PSP/WhatsApp autorizadas, pilotagem real e aceite final. Essas dependências **NÃO bloqueiam o desenvolvimento e a certificação interna de T08.2, T08.3, T08.4 e, na sequência apropriada, T09+**. Elas bloqueiam exclusivamente ativação/homologação comercial.

A base textual original fornecida pelo usuário sobre a Pizzaria Americana está preservada na Library do projeto (`PIZZARIA_AMERICANA_BASE_CONHECIMENTO.md`); ela não é mais carregada ou versionada como cadastro dentro do repositório. Para usá-la de verdade, a proprietária deverá conferir o conteúdo, registrar uma conta OWNER real e publicar o catálogo no banco do tenant/unidade selecionados.

## Configuração acessível por UI/API

Todas as rotas exigem sessão autenticada, membership do tenant e papel `OWNER`:
- `GET /api/establishments/units/:unitId/configuration` — retorna a configuração daquela unidade, versão e checks independentes;
- `PUT /api/establishments/units/:unitId/configuration` — salva `{expectedVersion, data}` com controle transacional de concorrência;
- `POST /api/establishments/units/:unitId/operation-mode` — registra `NATIVE_OPERATIONS` ou `INTEGRATED_OPERATIONS` por dono/unidade sem ativar produção;
- `POST /api/establishments/units/:unitId/owner-approval` — aceite somente do cliente OWNER autorizado, com evidência e versões reais do perfil T02 e catálogo T03.

As rotas antigas `/api/pilot/units/:unitId/onboarding/*` continuam como alias de compatibilidade sobre o **mesmo** repositório Firestore, nunca como uma segunda fonte de verdade.

Campos: segmento (`FOOD_SERVICE`, `RETAIL`, `SERVICES`, `BEAUTY`, `HEALTH_SERVICE`, `OTHER`), nome, endereço, telefones, nome da atendente, horários por dia, opções de atendimento, preços/áreas de entrega, preferências de pagamento, equipe, catálogo e modo. O cardápio e os preços efetivos de venda são publicados somente via **T03 /api/commerce**; o formulário de estabelecimento guarda referência e aceita dados parciais, sem gerar produtos de preço fictício. O motor de pagamentos é configurado separadamente e nunca aceita chave Pix nos campos de contato.

## Segurança e invariantes

1. O serviço recusa payload que tente impor tenant, nome de outra empresa, papel de segurança, estado `OWNER_ATTESTED` ou modo fora da allowlist.
2. Os dados armazenados são exclusivos do tenant/unidade autenticados. Alterar informações faz nova revisão, revogando aprovação anterior; concorrência CAS impede perda silenciosa.
3. Selecionar um modo é registrar intenção do cliente, não uma integração ativa: configurações e status canônicos T02, T03, T06 e conectores continuam protegidos. Integrado exige conector homologado antes do envio a PDV.
4. O formulário aceita draft incompleto de qualquer segmento. O piloto alimentar T08 valida `FOOD_SERVICE`; outros setores aguardam seus próprios capability packs.
5. O aceite da proprietária depende de perfil/catalogo efetivos, preços, horários, taxas, regras, prova de identidade e modo, mas **não é um requisito para concluir código e testes da próxima tarefa**.
6. T08.5 go-live permanece `NO_GO` até todas as evidências reais, sem forçar ativação por variável de ambiente, mock ou documentos internos.

## Situação da Pizzaria Americana

Cajamar/SP e CEP do logradouro 07793-530 foram apurados em fonte municipal. A associação do número 146 e a titularidade do estabelecimento exigem confirmação proprietária. Nada disso é escrito automaticamente no perfil de outro cliente ou em um banco de produção sem sessão autenticada. O nome da atendente, modo, preços e demais campos continuam editáveis pela proprietária no painel.

**Trava sequencial corrigida:** T08.1 engenharia concluída; **T08.2 liberada para engenharia**, mas seu uso real depende de credenciais/aceite externo. T08.3 e T08.4 seguem certificação técnica sequencial; T08.5 é autorização real.
