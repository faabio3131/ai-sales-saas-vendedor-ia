# T11 — Matriz de fechamento interno

| Requisito | Evidência exigida |
|---|---|
| Packs configuráveis salão, barbearia e estética administrativa | ScheduleConfig, capability grants, UI, schemas e testes |
| Perfil, preço/duração, seleção e confirmação persistida | T10 engine + policy acceptance, integração HTTP |
| Sinal exigido, verificação PSP, inadimplência sem confirmação | T11 E2E com adapter sintético; proteção T10 |
| Reagendamento, cancelamento, check-in e NO_SHOW | Máquina de estado, RBAC, CAS, locks persistidos |
| Comunicação, privacidade, consentimento e templates | Signed inbox, worker fencing, outbox, WABA utility preflight, sem envio clínico/marketing |
| Isolamento multiempresa e concorrência | Firestore emulador e testes em memória/HTTP, regras server-only |
| Regressão acumulada | Build/typecheck/tests/Python/Compose/Docker e CI pós-merge |

Resultado formal deve ser registrado somente após CI SUCCESS no HEAD e merge + CI SUCCESS na main. Homologação real PSP, Meta, aprovação dos templates e go-live de cada unidade são pendências externas, não de engenharia. T12 permanece travada até fechamento interno.
