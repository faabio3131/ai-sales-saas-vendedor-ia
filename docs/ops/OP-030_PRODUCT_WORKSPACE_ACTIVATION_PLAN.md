# OP-030 — Product Workspace Activation

## Estado
EM EXECUÇÃO.

## Objetivo
Substituir a antiga interface técnica de fundação por uma superfície real de produto, mobile-first e tenant-aware, capaz de levar um usuário autenticado ao seu ambiente comercial sem exigir conhecimento técnico de headers, IDs ou endpoints.

## Motivação
A OP-020 validou externamente Firebase Authentication, sessão backend, membership, isolamento tenant e leitura/escrita Firestore reais. O próximo gargalo não é infraestrutura: é usabilidade. O produto precisa apresentar os módulos comerciais existentes como aplicação utilizável antes do piloto real.

## Escopo autorizado
- descobrir memberships ativas do usuário autenticado sem enfraquecer o Tenant Gate;
- permitir seleção segura de empresa/tenant quando houver mais de uma membership;
- manter todas as APIs comerciais protegidas por `x-tenant-id` + `tenantAuthorizationMiddleware`;
- trocar a antiga `FoundationView` pela superfície `ProductWorkspaceView` após login;
- consumir o dashboard tenant-scoped existente;
- apresentar métricas e itens de atenção reais, sem inventar dados;
- preservar experiência mobile-first;
- adicionar regressão para descoberta de memberships;
- executar CI completo antes de qualquer fechamento.

## Fora de escopo
- integração WhatsApp real;
- provedor de IA real;
- pagamento real;
- piloto com empresa externa;
- declarar `PILOT_VALIDATED`;
- transformar o produto em ERP;
- remover isolamento tenant ou autenticação para facilitar a UI.

## Regra de segurança
`GET /api/tenancy/memberships` é apenas uma etapa autenticada de descoberta das memberships do próprio principal. A descoberta não autoriza operações de negócio. Toda operação comercial continua exigindo tenant selecionado e autorização tenant-scoped no backend.

## Entrega inicial
1. `TenantMembershipRepository.listActiveMemberships`;
2. endpoint autenticado de descoberta de memberships;
3. `ProductWorkspaceView` real após login;
4. seleção/persistência local do tenant ativo;
5. dashboard real tenant-scoped;
6. regressão de memberships;
7. CI completo.

## Critério de saída
A OP-030 só poderá ser fechada quando:
- build PASS;
- typecheck PASS;
- testes PASS;
- security boundaries PASS;
- Docker production smoke PASS;
- usuário autenticado conseguir entrar no workspace sem manipular headers manualmente;
- tenant selecionado for sempre revalidado pelo backend;
- ausência de membership falhar fechado;
- nenhuma métrica comercial fictícia for apresentada.

## Hardening interno adicional
- descoberta de memberships falha fechado com HTTP 403 quando o usuário autenticado não possui membership ativa;
- o handler de descoberta aceita repositório injetável para teste determinístico sem Firebase real;
- testes cobrem: principal autenticado, filtragem de memberships e ausência de membership ativa;
- o gate de runtime inclui `/api/tenancy/memberships` entre as rotas que devem rejeitar acesso sem sessão.

## Próxima validação externa
Após CI verde e deploy da `main`, abrir a aplicação de produção, autenticar com o usuário de teste já validado e confirmar que o workspace carrega automaticamente o tenant autorizado e o dashboard comercial.
