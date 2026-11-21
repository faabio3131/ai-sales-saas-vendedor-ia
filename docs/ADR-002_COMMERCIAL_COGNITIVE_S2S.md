# ADR-002 — T01 Commercial Cognitive Core: Python interno + adaptador TypeScript

**Decisão técnica de implementação:** 21/11/2026. **Estado:** implementação candidata (depende da certificação T01).
**Autoridade:** cronograma com trava e Arquitetura Mestre; sem deploy automático.
**Escopo:** integração cognitiva sem migrar o domínio, o banco nem o stack comercial.

## Inventário verificado em SHAs congelados
| Fonte | SHA auditado | Aproveitamento permitido |
|---|---|---|
| FM Core Base `faabio3131/FM-Core-Base-` | `d02d9dad2d3b77c03495ee5c7f847122578c238c` | IA routing, origem e cálculo determinístico de custo, eventos, retries, isolamento e FinOps |
| NFCore cognitivo `faabio3131/cognitivo-nfcore-inteligencia-fiscal` | `ca3235036254d1d5113c891902bcbd1aaa1cb022` | ContextPack separado, proveniência, redaction, output guard, circuit breaker, bulkhead, deadline |
| AtendeVendeIA `faabio3131/ai-sales-saas-vendedor-ia` | `6cd0b4e5d2833d02a6178a2438f9913412f9b355` | `AIRouterInterface`, `SalesEngine`, `PolicyEngine`, auth/tenant, backend TypeScript, Gemini adapter |

A integração é **seletiva de padrões e contratos**, não importação binária de código fiscal e não integração operacional com NFCore. O contrato S2S central do NFCore documentado em `docs/NFCORE_COGNITIVE_S2S_CONTRACT_V1.md` foi explicitamente **substituído em 31/10/2026**: não foi reutilizado como dependência do Command.

## Escolha
- Serviço Python `cognitive_service` interno, **stdlib**, com endpoint privado `POST /v1/execute`, sem credencial Firebase, acesso ao Firestore, emissão fiscal, mutação comercial ou outras ferramentas externas. Não será exposto ao cliente.
- Adaptador TypeScript `CognitiveServiceAdapter` implementa `AIProviderInterface` preservando `AIRouterInterface` e todos os serviços existentes.
- Contrato `atendevende.cognitive/v1` fixa o escopo `tenantId`, `requestId`, capability, hash SHA-256 de ContextPack e evidências. O contexto aceito passa por builder backend que rejeita evidências de outro tenant/unidade e elimina dados sensíveis. O payload do cliente é tratado apenas como **dado não confiável**.
- Autorização de transporte S2S: HMAC-SHA256 sobre timestamp + nonce + bytes exatos do JSON, ±300 s passado e 30 s futuro, verificação em tempo constante, nonce não reutilizável por processo; host privado com TLS em deploy externo. Chave de pelo menos 32 caracteres, somente via secret environment do backend e Python.
- Python responde apenas com **proposta comercial determinística**, identificada como `commercial-baseline-v1`, sem alegação de IA generativa e sem autorização de executar operações. Usado como fallback seguro/ambiente de testes, não como substituto automático de Gemini.
- `ResilientAIRouter` governa prioridade de modelos, limitação de concorrência, deadline, circuit breaker, fallback e medição de tentativas. **Gemini mantém precedência por padrão** quando habilitado. `COGNITIVE_ROUTE_PRIORITY=COGNITIVE_FIRST` é opt-in para validação controlada.
- `SalesEngine` valida a proposta normalizada e **sempre** aplica `PolicyEngine`. Não executa a ação; falha da IA resulta na decisão determinística existente.
- `CognitiveFinops` guarda eventos por tenant/rota/latência/status, com custo de modelo **UNKNOWN** sem snapshot tarifário aprovado. Baseline Python não chama modelo pago: custo de tokens `0` não é custo total de infraestrutura. `COGNITIVE_METERING_ENABLED=true` habilita escrita auditável apenas de metadados no Firestore, nunca prompts ou segredos.

## Trade-offs e riscos
1. Runtime Python separado precisa ser implantado e protegido posteriormente junto à API. T01 prova integração real em CI via loopback, **não** certifica Contabo, mTLS, firewall, secret provisionado nem latência externa.
2. Antirreplay in-memory é suficiente para **uma instância isolada de teste**, não para réplicas distribuídas. Antes de escala horizontal, usar store de nonce/Idempotency-Key compartilhado ou gateway S2S com controle distribuído.
3. O motor baseline não usa modelo e não possui conhecimento do cardápio; T02 implementa conhecimento por tenant. Nenhum preço/horário deve ser gerado pelo baseline.
4. Custo real de Gemini permanece UNKNOWN sem tabela oficial versionada; não atribuir custos inventados ou tratar métricas mock como faturamento.
5. Credenciais S2S/telemetria são provisionamento operacional externo e não serão incorporadas a commits, PRs nem logs.

## Contratos, testes e governança
- `cognitive_service/test_core.py`: valida assinatura, replay, contrato, escopo, hash e injection.
- `tests/t01CognitiveIntegration.test.ts`: prova transporte HMAC, redaction, provenance, OutputGuard, policy, fallback, breaker, bulkhead e custos; smoke HTTP real com Python iniciado na CI.
- `.github/workflows/blk010-validation.yml`: Python unittest + HTTP real + build, typecheck, regressão acumulada, segurança e Docker.
- Nenhuma nova API pública e nenhuma permissão administrativa/cobrança alterada.
- T01 não cria pedidos, agenda, delivery, integração financeira real nem faz deploy.
- Avanço para T02 depende de T01 100% certificada no mesmo HEAD, evidências e decisão humana, conforme cronograma mestre.
