# BLK-180 — Hardening — Plano

**Status:** AUTORIZADO PARA IMPLEMENTAÇÃO

## Objetivo
Endurecer segurança, limites operacionais, observabilidade básica e regressão antes do piloto.

## Escopo
- headers de segurança no backend;
- limite explícito de payload JSON;
- rate limiting em memória, fail-safe e sem dependência externa;
- request id/correlation id básico no boundary HTTP;
- testes de segurança e regressão;
- atualização do runtime marker e CI;
- limpeza documental de referências obsoletas ao Google AI Studio como ambiente oficial de desenvolvimento.

## Fora de escopo
- WAF/CDN gerenciado;
- SIEM/APM externo;
- Redis/distributed rate limiter;
- load test de produção;
- deploy e piloto real (BLK-190).

## Gates
Architecture, Tenant, Security, Test, Documentation e Git obrigatoriamente verdes.
