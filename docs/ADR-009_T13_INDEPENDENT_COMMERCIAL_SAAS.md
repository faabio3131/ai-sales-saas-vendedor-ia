# ADR-009 — T13 como SaaS comercial independente

Data: 2026-11-24. Decisão de produto: aprovada pelo Diretor nesta data, implantação final ainda não certificada. Este registro não altera a autorização de go-live.

## Decisão e escopo
- `fm-vendedor-recuperacao-vendas`: atendente interna FM; FastAPI/Next.js/PostgreSQL/Evolution. Preservar instalação, dados, sessões, credenciais, webhooks, workers, DNS e proxy existentes.
- `ai-sales-saas-vendedor-ia`: novo SaaS comercial multissetorial; Node/React/Firestore. Nome comercial, domínio e identidade de cobrança próprios a definir. Não migrar dados, unificar repositórios, reutilizar contas de canal ou credenciais da atendente interna.
- Coexistência inicial no mesmo host, com fronteiras de execução, identidade, armazenamento e rede separadas. Nenhuma alteração na aplicação interna é autorizada por esta ADR. Integração futura com Command somente via contratos governados, não por compartilhamento direto de banco.

## Evidências e limites
- Baseline main: 3b5dda8eca8c674a3a99b27975529a64136e6769; selagem run 45295454412 attempt 1 SUCCESS; imagem sha256:3eba7ef9777542c52f2eaed92d5d4d002f566505ed5905bc1bc6ca2c5e7efa80.
- Última execução de produção 45311171102: aprovação nativa passou, execução falhou no gate de identidade Firebase. Não é deploy aprovado.
- Operador demonstrou em terminal: regras Firestore reconciliadas (comparação local PASS), Cosign instalado e assinatura/digest/label OCI verificados, API isolada com network none healthy, sem credenciais reais, sem worker, serviços anteriores permaneceram em execução. Evidência operacional informada pelo operador; não equivale a execução bem-sucedida do workflow.
- Backup lógico PostgreSQL e restore isolado com 28 migrations e RLS PASS; backup externo/custódia das chaves continuam pendentes, em trilha independente da atendente interna. Não afirmar recuperação de todo o servidor.
- A versão anterior é preservada, não é alvo de migração. Nenhum go-live comercial, cobrança, emissão fiscal, canal real ou homologação T08.5 aprovado.

## Gates restantes da T13.7
1. Inventário read-only do projeto Firebase candidato e workloads Cloud Run históricos. Confirmar que não há compartilhamento com a atendente interna; verificar Auth, índices, regras ativas e fonte de verdade. Se existir workload concorrente, definir autoridade única antes de qualquer worker. Não criar projeto, trocar credenciais ou migrar dados automaticamente.
2. Identidade de leitura exclusiva para gate de regras, curta duração e sem permissão de escrita; preferir OIDC/WIF com vínculo ao workflow/ambiente aprovados. O gate atual exige token e não envia x-goog-user-project; validar com o mecanismo efetivo, não assumir que o sucesso local com quota header é sucesso no CI. Não guardar token administrativo ou chave de conta de serviço ampla.
3. Provisionar runtime exclusivo (segredo sessão, identidade Firebase, registro OCI, diretório, porta e rede próprios). Não conceder à chave CI root ou acesso ao socket Docker da atendente interna. Preferir engine rootless dedicado ou host isolado; comprovar compatibilidade com script de rollout, UID de montagem e storage antes de ativar. Acesso SSH do runner exige rota e host key pinada; não desativar firewall ou host key checking.
4. O workflow existente inicia API e reconciliador conjuntamente; o reconciliador executa consultas e mutações financeiras, governança e outbox fiscal. Flags da API não provam que workers são inertes. Exigir isolamento de dados e autoridade única, teste sem transações reais e autorização de escopo antes de executar o worker. Nenhum worker duplicado.
5. Domínio e HTTPS próprios, sem alterar hosts/rotas existentes. Primeiro health, login, sessão, tenant/unit, testes negativos, rollback exclusivo. Revisar requisitos de autenticação web e índices. Validação operacional e ativação comercial são separadas.
6. Executar workflow de produção com autorização nativa exata, CI e atestados para o SHA corrente. Registrar logs de health, testes e rollback; atualizar cronograma mestre somente com evidência. Mudança em main exige nova CI/selagem/revisão aplicável; manter esta ADR em branch documental até janela de incorporação para evitar anti-drift.
7. WhatsApp: canal de teste dedicado da Meta Cloud API, não vincular nem migrar número da atendente FM. Número de teste e destinatário autorizado serão necessários somente na homologação externa depois de HTTPS, tenant/unit OWNER, cofre, challenge, assinatura, dedupe e gates de envio. Preservar T08.5 NO_GO até evidências e aprovação separada.

Status: DECISÃO APROVADA / SMOKE ISOLADO PASS / DEPLOY GOVERNADO PENDENTE / COMMERCIAL GO-LIVE NO_GO.
