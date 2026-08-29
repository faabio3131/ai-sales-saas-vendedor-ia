# BLK-170 — Plans / Billing — Fechamento

**Status:** IMPLEMENTADO / TESTADO / VALIDADO

## Implementado
- planos BASIC, STANDARD, PRO e PREMIUM;
- catálogo determinístico de features e limites;
- Subscription tenant-scoped;
- `FeatureEntitlementService.canUse()`;
- `FeatureEntitlementService.getLimits()`;
- fail-closed para assinatura ausente/inativa/fora do período;
- effective limits por tenant;
- UsageCounter e UsageService com bloqueio de extrapolação;
- adapters Firestore;
- API `/api/plans` protegida por autenticação e tenant authorization.

## Validação executada
GitHub Actions run `33227686113` no commit `606ea9b3069c08cbc2b7a4e689d825cc3bb68600`:
- Build: PASS;
- Typecheck: PASS;
- 17 arquivos de teste: PASS;
- 102/102 testes: PASS;
- 6/6 testes específicos de Plans/Billing: PASS;
- Runtime BLK-170: PASS;
- boundary `/api/plans/plan` sem sessão: 401 PASS;
- tenant isolation e regressões anteriores: PASS.

## Limitações deliberadas
- não há adquirente externo de assinatura;
- não há checkout recorrente/invoice/proration;
- uso Firestore ainda requer endurecimento transacional para incrementos altamente concorrentes antes de escala financeira/limites críticos.

## Gates
Architecture ✅ Tenant ✅ Security ✅ Test ✅ Documentation ✅ Git ✅

**Conclusão:** BLK-170 pronto para fechamento técnico. Próximo bloco canônico: BLK-180 — Hardening, somente após autorização do Diretor.
