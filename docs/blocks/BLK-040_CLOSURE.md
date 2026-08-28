# BLK-040 — Catalog — Closure

**Status:** IMPLEMENTADO, VALIDADO E FECHADO.

## Escopo entregue
- modelo tenant-scoped para produtos e serviços;
- `CatalogRepository` como contrato de persistência;
- `CatalogService` com criação, leitura, listagem e atualização básica;
- preços em unidade monetária menor (`priceMinor`) e moeda BRL;
- ativação/desativação de itens;
- adapter Firestore sem acoplamento do domínio ao SDK;
- rotas `/api/catalog` protegidas por autenticação e autorização de tenant;
- isolamento explícito entre tenants para leitura e atualização;
- testes de domínio, validação monetária e isolamento.

## Validação executada
Workflow GitHub Actions `Project Validation`, run `33216407607`:
- install dependencies: PASS;
- build: PASS;
- typecheck: PASS;
- tests: PASS — 4 arquivos, 25 testes;
- runtime health: PASS — `BLK-040`;
- runtime auth/tenant/catalog boundary: PASS;
- chamada não autenticada a `/api/catalog` com tenant forjado: bloqueada com HTTP 401 / `SESSION_REQUIRED`.

## Incidente durante validação
A primeira execução do BLK-040 encontrou uma asserção de teste incorreta para uma validação síncrona de preço. A implementação rejeitava corretamente o valor inválido; o teste tratava a exceção como Promise rejection. O teste foi corrigido e a suíte completa foi reexecutada com sucesso.

## Limitações honestas
- o adapter Firestore está implementado, porém ainda não foi validado contra um projeto Firebase real com dados reais;
- UI dedicada de gestão de catálogo não foi incluída neste bloco; o domínio e a API protegida estão preparados para a camada de apresentação futura;
- não foram implementados clientes, conversas, IA, vendas, follow-up, pagamentos ou outros blocos posteriores.

## Gates
- Architecture Gate: PASS;
- Tenant Gate: PASS;
- Security Gate: PASS;
- Test Gate: PASS;
- Documentation Gate: PASS;
- Git Gate: PASS.

## Resultado
BLK-040 atende ao objetivo canônico de produtos/serviços e regras básicas de catálogo por tenant e está pronto para encerramento formal.
