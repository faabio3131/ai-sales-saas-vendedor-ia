# BLK-120 — Channels / WhatsApp — Plano de Execução

**Status:** AUTORIZADO PELO DIRETOR em 2026-08-28 após fechamento verde do BLK-110.

## Objetivo
Implementar a camada universal de canais e o primeiro adapter WhatsApp, preservando independência de provedor, tenant isolation e segurança de webhook.

## Escopo
- contratos normalizados de mensagem inbound/outbound;
- `ChannelInterface` com `sendMessage`, `normalizeInbound`, `validateWebhook`;
- `ChannelService` provider-neutral e tenant-scoped;
- primeiro `WhatsAppAdapter` atrás de transport/verifier injetáveis;
- normalização de payload inbound para DTO canônico;
- validação obrigatória de webhook antes de normalização;
- idempotency key obrigatória em envio outbound;
- erros de provedor sanitizados;
- testes de contrato, tenant, webhook, normalização e falhas;
- runtime/CI em BLK-120.

## Fora de escopo
- credenciais reais Meta/WhatsApp no repositório;
- provisionamento de número/Business Manager;
- endpoint webhook público multi-tenant sem resolução segura de `ChannelConnection`;
- disparos de campanha;
- templates comerciais reais;
- persistência de `ChannelConnection` e secrets;
- automação de follow-up/recovery via WhatsApp.

## Critério de saída
Build, typecheck, testes e runtime security boundaries verdes; adapter WhatsApp testável sem credenciais; nenhuma chamada externa real executada; fechamento documental após CI real.