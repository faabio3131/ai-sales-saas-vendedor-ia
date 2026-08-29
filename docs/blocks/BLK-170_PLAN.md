# BLK-170 — Plans / Billing — Plano

**Status:** AUTORIZADO PARA IMPLEMENTAÇÃO

## Objetivo
Implementar planos, assinatura tenant-scoped, entitlement centralizado e medição de uso/limites sem acoplar o domínio a um provedor externo de billing.

## Escopo
- planos `BASIC`, `STANDARD`, `PRO`, `PREMIUM`;
- catálogo determinístico de features/limites;
- `Subscription` por tenant;
- `FeatureEntitlementService.canUse()` e `getLimits()`;
- medição de uso tenant-scoped por período;
- fail-closed para assinatura ausente/inativa;
- API protegida para consultar assinatura, entitlements e registrar uso interno autorizado;
- adapters Firestore e testes de tenant isolation/limites.

## Fora de escopo
- checkout de assinatura real;
- cobrança recorrente em adquirente externo;
- invoices, impostos e fiscal;
- proration/refunds de assinatura;
- portal de billing externo.

## Regra de arquitetura
Plano/entitlement é dimensão distinta de autonomia. Nenhuma feature paga pode ser liberada apenas pelo modo de autonomia.
