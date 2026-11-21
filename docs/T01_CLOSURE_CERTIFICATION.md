# T01 — CERTIFICAÇÃO INTERNA DO BLOCO COGNITIVO

**Data:** 21/11/2026. **Tarefa:** T01 do Cronograma Mestre v1.1.  
**Escopo autorizado:** integração cognitiva comercial interna com trava sequencial.  
**Estado da engenharia candidata:** 100% dos critérios de aceite internos satisfeitos na CI da PR #11.  
**Estado externo:** sem deploy, sem credencial real de produção, sem ativação da Pizzaria Americana e sem liberação da T02.

## Evidência canônica
- PR consolidada: [#11](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/11).
- HEAD funcional certificado (antes do documento de fechamento): `c150420e9d7cb66ca4335baadd5796fea6fd761a`.
- CI cumulativa: [#44906758883 — SUCCESS](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44906758883).
- Essa CI executou build, TypeScript, **Python unittest (7)**, testes Vitest cumulativos, runtime security boundaries, Compose de pagamentos, Docker Node e Docker Python não-root.
- Os testes Vitest incluem execução **HTTP real** do Python S2S; dentro do Docker Node a integração externa é ignorada intencionalmente (a etapa CI de teste integrado executa a prova real).
- Certificação pós-merge da main deve ser consultada em CI do SHA final de integração; aprovação da PR não é prova de deploy.

## Repositórios auditados
| Componente | SHA de referência |
|---|---|
| FM-Core-Base- | `d02d9dad2d3b77c03495ee5c7f847122578c238c` |
| cognitivo-nfcore-inteligencia-fiscal | `ca3235036254d1d5113c891902bcbd1aaa1cb022` |
| ai-sales-saas-vendedor-ia (base da T01) | `6cd0b4e5d2833d02a6178a2438f9913412f9b355` |

## Entregas funcionais verificadas
1. Serviço cognitivo Python STDLib, privativo e sem permissões para escrita no domínio.
2. Adaptador TypeScript com HMAC SHA-256 no corpo exato, timestamp, nonce e timeout.
3. Context Pack multitenant, evidências autorizadas, hash determinístico e bloqueio de escopo cruzado.
4. Mascaramento de PII e segredos para **todas** as rotas de IA no caminho comercial.
5. Output Guard com rejeição de alegações de cobrança, valores não fundamentados e proveniência inválida.
6. Router com priorização conservadora (Gemini se configurado), fallback, circuit breaker, bulkhead e deadline.
7. FinOps tenant-scoped por resultados e origens de custos; UNKNOWN sem tabela de preços, baseline sem custo de tokens de modelo pago.
8. Runtime realmente ligado à rota de decisão comercial, sob a política de aprovação humana preexistente.
9. Parse estrito de JSON estruturado do Gemini, com fallback seguro se saída inválida.
10. Container isolado de Python executável e smoke validado; documentação de configuração segura.

## Gates de aceite T01
- [x] Jornada comercial existente do `SalesEngine` executa roteador/serviço Python via HTTP real em CI; o `SalesDecisionService` executa a integração e nega lead de outro tenant.
- [x] Saída estruturada, proveniência, privacidade, injeção, validação de tenant, deadline, fallback e controle de concorrência testados.
- [x] Build, typecheck, testes cumulativos, segurança e Docker aprovados em execução vinculada ao mesmo HEAD funcional.
- [x] Nenhuma integração simulada é declarada homologação bancária, deployment, IA externa provisionada ou configuração real de tenant.

## Restrições e estado externo (não são pendências de engenharia T01)
- Sem servidor Python em produção, credencial real S2S nem rede privada/proxy/TLS homologados. Ativação operacional pertence à trilha T08.
- Sem preços/custos reais de IA não versionados. Custo UNKNOWN permanece UNKNOWN.
- Replay cache por processo: antes de escalar horizontalmente é obrigatório um mecanismo compartilhado.
- Não altera pagamentos, emissão fiscal, sistemas de cozinha ou T02–T12.
- Próximo bloco só começa após critério de trava e autorização humana, conforme cronograma.
