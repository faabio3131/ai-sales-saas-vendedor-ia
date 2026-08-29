# BLK-150 — Payments — Plano

**Status:** APROVADO PARA IMPLEMENTAÇÃO pelo Diretor.

## Objetivo
Implementar a fundação provider-neutral de pagamentos com PaymentService, PaymentProviderInterface, Pix/link, persistência tenant-scoped e processamento de webhook validado e idempotente.

## Escopo
- Payment e estados base;
- dinheiro em minor units e BRL;
- PaymentProviderInterface canônica;
- criação de Pix e link a partir de quote ACCEPTED;
- idempotencyKey obrigatória para criação;
- confirmação apenas por status obtido server-side ou webhook validado;
- deduplicação por webhook eventId;
- repository Firestore atrás de interface;
- API protegida por autenticação + tenancy;
- testes de tenant isolation, idempotência, webhook duplicado e sanitização de provider errors.

## Fora de escopo
Credenciais reais, SDK específico de adquirente, checkout web real, cartão, refund operacional real, Sale completa, conciliação financeira e billing SaaS.

## Regra de segurança
Nenhum payload do cliente pode marcar pagamento como CONFIRMED. Confirmação somente por provider adapter após validação server-side. Segredos permanecem server-side e nenhum token real será versionado.

## Gate de saída
Build, typecheck, testes, runtime boundary, tenant isolation e webhook idempotente verdes no GitHub Actions.