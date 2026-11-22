# T12 — Matriz de certificação interna

| Requisito | Evidência |
|---|---|
| Sete modelos / dois modos | Testes de 14 combinações e onboarding transacional |
| Catálogo, carrinho, ordem e estoque básicos | RetailService + HTTP + concorrência Firestore |
| PSP opcional e caixa manual | Claim, GET exato, replay, falha incerta e valores distintos |
| Serviços / reservas | T10/T11 regressão e onboarding real do emulador |
| Relatórios, plano, grounding | Agregados por fonte, assinatura ativa, preço versionado |
| Segurança | RBAC, capability grant, tenant/unit, regras server-only e gates de runtime |
| Integração | Build/typecheck/CI integral e pós-merge |

Resultado formal de engenharia deve constar na PR #28 após CI íntegra e pós-merge SUCCESS. Aprovação comercial do Diretor, homologação de provedores e go-live são etapas distintas, não declaradas realizadas.
