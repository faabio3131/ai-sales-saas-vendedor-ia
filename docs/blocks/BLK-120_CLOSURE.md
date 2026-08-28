# BLK-120 — Channels / WhatsApp — Fechamento

**Status:** IMPLEMENTADO, TESTADO E VALIDADO.

## Entrega
- `ChannelInterface` provider-neutral com `sendMessage`, `validateWebhook` e `normalizeInbound`;
- `ChannelService` tenant-scoped;
- `WhatsAppAdapter` isolado atrás de `WhatsAppTransport` e `WhatsAppWebhookVerifier`;
- outbound exige `idempotencyKey`;
- webhook é validado antes da normalização;
- normalização de mensagens inbound estilo WhatsApp Cloud para DTO canônico sem expor payload bruto;
- suporte normalizado a texto e referências de mídia;
- falhas de provedor sanitizadas;
- endpoint protegido `/api/channels` informa capacidade estrutural sem expor secrets;
- nenhuma credencial real ou chamada externa real foi adicionada.

## Validação real
GitHub Actions run `33221361370`, commit `0b356e55c1fb9a66d7824e9c5f2d5fd589ad083d`:
- Install: PASS
- Build: PASS
- Typecheck: PASS
- Tests: PASS
- Runtime security boundaries: PASS
- 12 arquivos de testes PASS
- 74/74 testes PASS
- `tests/channels.test.ts`: 7/7 PASS
- runtime `BLK-120`
- `/api/channels` sem sessão: 401 `SESSION_REQUIRED`

## Limitações honestas
- WhatsApp/Meta real não foi conectado nem chamado;
- número, Business Manager, token, app secret e webhook público ainda não foram provisionados;
- não existe `ChannelConnection` persistida neste bloco;
- um webhook público real multi-tenant exige resolução segura da conexão/tenant antes de ser habilitado;
- campanhas/disparos, templates reais e automações via WhatsApp continuam fora deste bloco.

## Gates
Architecture ✅ | Tenant ✅ | Security ✅ | Test ✅ | Documentation ✅ | Git ✅
