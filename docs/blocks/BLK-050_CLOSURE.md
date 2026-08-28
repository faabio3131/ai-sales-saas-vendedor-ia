# BLK-050 — Customers — Closure

**Status:** IMPLEMENTADO, TESTADO E VALIDADO.

## Escopo entregue
- entidade `Customer` tenant-scoped;
- entidade `CustomerMemory` separada do histórico bruto e do registro principal do cliente;
- contratos `CustomerRepository` e `CustomerMemoryRepository`;
- adapters Firestore isolados do domínio;
- criação, listagem, consulta e atualização de clientes;
- leitura e atualização da memória comercial base;
- normalização mínima de telefone/e-mail e validação de identidade externa;
- deduplicação de identidade externa dentro do mesmo tenant;
- proteção contra leitura/escrita cross-tenant;
- API protegida em `/api/customers` e `/api/customers/:id/memory`.

## Segurança e privacidade
- nenhum `customerId` ou `tenantId` informado pelo cliente substitui o `TenantContext` autorizado;
- consultas e persistência são tenant-scoped;
- memória comercial não é misturada ao histórico bruto de conversas;
- limites básicos reduzem armazenamento arbitrário de dados em memória;
- rotas exigem autenticação e membership ativa de tenant.

## Validação executada
GitHub Actions `Project Validation`, run `33216982956`:
- `npm run build`: PASS;
- `npm run typecheck`: PASS;
- `npm test`: PASS;
- 5 arquivos de teste PASS;
- 30/30 testes PASS;
- runtime `/api/health`: PASS com `block = BLK-050`;
- `/api/customers` sem sessão válida: 401 / `SESSION_REQUIRED`;
- regressões de autenticação, tenancy e catálogo preservadas.

## Limitações conscientes
O adapter Firestore está implementado, porém ainda não foi validado contra um projeto Firebase de produção com dados reais. A criação automática de Customer a partir de mensagens/conversas fica para os blocos de Conversations/Channels, onde existe o evento real de entrada. Nenhuma IA atualiza `CustomerMemory` neste bloco; isso será integrado somente após a AI Foundation e regras de extração/validação.

## Decisão
BLK-050 satisfaz o escopo autorizado e está pronto para fechamento. A promoção para BLK-060 depende de autorização explícita do Diretor.
