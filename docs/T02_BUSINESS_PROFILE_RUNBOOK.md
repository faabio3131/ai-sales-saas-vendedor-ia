# T02 — Operação, contratos e testes do Knowledge & Memory Fabric

**Data:** 21/11/2026. Escopo: engenharia interna T02, sem deploy/ativação real.
**Pré-requisito:** T01 certificada. **Trava:** T03 só com T02 100% verde, evidências e autorização humana.

## Contratos HTTP
Todas as rotas abaixo estão sob `/api/business` e **herdam autenticação real e validação de membership por tenant**. O header de tenant só seleciona um tenant ao qual o usuário autenticado já pertence; não cria autoridade. Gestão de perfil e memória exige papel `OWNER` ou `ADMIN`.

- `GET /units/:unitId/active` — resolução do perfil vigente, eventualmente `null`.
- `GET /units/:unitId/latest` — última revisão, somente admin, incluindo futuras.
- `POST /units/:unitId/revisions` — publicar revisão imutável, `expectedVersion` obrigatório.
- `POST /units/:unitId/answer` — pergunta comercial; retorna `ANSWERED`, `UNKNOWN` ou `CONFLICT`, com `evidenceIds`. Não cria pedido.
- `GET /units/:unitId/context` — evidências empresariais aptas ao ContextPack T01.
- `GET /units/:unitId/customers/:customerId/memory` — memória com consentimento válido, ou `null`.
- `POST /units/:unitId/customers/:customerId/memory/consent` — declaração e **verificação** de consentimento explícito através de referência a mensagem inbound do cliente (inclui `expectedVersion`).
- `PUT /units/:unitId/customers/:customerId/memory` — salvar resumo e preferências com provas de origem, consentimento válido e `expectedVersion`.
- `POST /units/:unitId/customers/:customerId/cognitive-context` — montar requisição T01 com evidências públicas do negócio e memória permitida.
- `DELETE /units/:unitId/customers/:customerId/memory?expectedVersion=n` — remoção física condicional à versão.

## Exemplo de configuração (APENAS DADOS ILUSTRATIVOS)
```json
{
  "expectedVersion": 0,
  "effectiveFrom": "2026-11-21T12:00:00.000Z",
  "identity": {"assistantName": "Atendente do Meu Restaurante", "voiceStyle": "FRIENDLY"},
  "capabilityRegistry": {
    "vertical": "FOOD_SERVICE",
    "capabilities": ["FOOD_SERVICE", "ORDERING", "PRODUCTION", "DELIVERY"],
    "operationMode": "NATIVE_OPERATIONS",
    "integrationStatus": "NOT_CONFIGURED"
  },
  "policy": {
    "timezone": "America/Sao_Paulo",
    "locale": "pt-BR",
    "memoryRetentionDays": 30,
    "personalMemoryDefault": "DENY",
    "prohibitUnverifiedClaims": true
  },
  "facts": [
    {"id": "hours", "kind": "HOURS", "question": "Qual o horário?",
     "answer": "Atendimento de terça a domingo.", "sourceRef": "gestor:horarios-confirmados"}
  ]
}
```
O nome, horário e política acima **não são dados oficiais da Pizzaria Americana**. A proprietária deverá validar as informações em T08.1. O modo `INTEGRATED_OPERATIONS` é alternativo por unidade, mas só ficará funcional quando as integrações PDV/KDS forem implementadas/homologadas em T06/T08.

## Fontes de verdade
- Preços: somente catálogo ativo e versionado (o catálogo atual é tenant-scoped; escopo por unidade em T03).
- Horários e políticas: revisão vigente aprovada pela administração; ausência de resposta exata => UNKNOWN.
- Consentimento: a referência `conversation:<conversationId>:<messageId>` deve apontar a uma mensagem persistida do próprio cliente, enviada no sentido INBOUND com frase literal `AUTORIZO MEMÓRIA COMERCIAL`. Mensagem de operador/IA ou outro tenant é rejeitada.
- Evidências de memória: mesma forma de referência a mensagens do cliente/tenant; armazenamento redigido e limitado.
- Não reutilizar `CustomerMemory` legada para personalização cognitiva sem consentimento explícito.

## Retenção e remoção
- A gravação gera `expiresAt`; leitura pós-prazo é imediatamente negada, inclusive se o coletor não estiver executando.
- `npm run build && npm run purge:business-memory` executa a limpeza física **de forma controlada e limitada**. O worker precisa de acesso Firestore autorizado, que será provisionado na implantação, sem colocar segredos no GitHub.
- Recomenda-se agendar essa execução na infraestrutura do piloto e monitorar `business_memory_purge_completed` ou `business_memory_purge_failed`. Nenhum agendamento de produção está sendo declarado ativo nesta T02.
- Revogação limpa preferências e resumo e bloqueia uso pelo Core; a exclusão explícita remove o documento. Políticas de retenção legal de registros legados devem ser tratadas separadamente.

## Checklist de engenharia
1. Publicar versões 1 e 2 para duas empresas e unidades isoladas; simular conflitos de versão e vigência.
2. Forçar pergunta de preço sem catálogo ativo e verificar `UNKNOWN`.
3. Testar nomes de produtos ambíguos, fatos contraditórios, revogação, ausência de consentimento e spoofing cross-tenant.
4. Construir Context Pack T01, verificar IDs de evidência e ausência de segredos.
5. Certificar `npm run build`, `npm run typecheck`, `npm test`, testes Python e ambos os Docker smokes.
6. Verificar PR, SHA, CI do HEAD e registrar no Cronograma Mestre antes da autorização da T03.
