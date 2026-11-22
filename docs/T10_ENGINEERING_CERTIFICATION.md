# T10 — Matriz de certificação interna

PR #26 — Scheduling Engine horizontal. Dependência T09: PR #25, main f6ab241, CI #44975729301 SUCCESS.

| Requisito | Evidência |
|---|---|
| Agenda e catálogo de serviços, recursos, profissionais, turnos, unidades | Config versionada, modelo e API/GUI, rules.ts |
| Disponibilidade, DST, timezones, feriados, bloqueio de recurso | Testes determinísticos de IANA, feriados, turnos e intervalos |
| Atomicidade e corrida | Race em memória e Firestore emulador, tenant fence e locks sem PII |
| Reserva e confirmação persistidas, reagendamento e cancelamento | Máquina de estado, CAS, recibos, histórico e API |
| Isolamento, privacidade e autenticação | Membership, RBAC, profile/capability em transação, regras server-only no emulador, dados privados isolados |
| Lembrete | PENDING/READY/ACKNOWLEDGED/CANCELLED, índice due, worker Compose, nenhum envio externo alegado |
| Sinal opcional | Pix por adapter existente, claim durável, GET exato do PSP, replay e settlement tardio, NO_GO real |
| Regressão e deploy interno | CI integral do HEAD e pós-merge, gate explícito em memória/emulador, worker Compose e smokes Docker |

**Resultado oficial:** anexar evidência de CI SUCCESS do HEAD final, merge e CI pós-merge SUCCESS ao comentário de encerramento da PR #26. Não registrar PASS sem execução. T11 fica travada até confirmação. O trabalho de engenharia não depende de atendimento, recebedor, credenciais, PSP/Meta reais, cadastro externo, deploy público ou aceite da Pizzaria Americana.
