# OP-020 — Firebase/Auth/Firestore Real Activation

## Estado
EM EXECUÇÃO — infraestrutura externa real validada parcialmente em produção. Firebase Admin, Firebase Authentication e Firestore estão alcançáveis a partir do Cloud Run; os testes funcionais de sessão real, membership e isolamento tenant A/B ainda permanecem pendentes antes do fechamento operacional.

## Objetivo
Ativar de forma governada o caminho real de Firebase Authentication e Firestore já abstraído no produto, sem versionar segredos e sem confundir prontidão estrutural com validação externa.

## Escopo
- auditar o adapter Firebase Auth e o repositório Firestore de membership;
- centralizar bootstrap do Firebase Admin para impedir inicializações divergentes;
- falhar fechado quando produção não possuir `FIREBASE_PROJECT_ID`;
- preparar verificação segura de conectividade real;
- documentar criação/configuração mínima do projeto Firebase;
- preservar isolamento multi-tenant e interfaces existentes;
- adicionar testes sem dependência de credenciais reais.

## Evidência externa já obtida
Ambiente real de produção respondeu ao probe seguro `/api/operations/firebase-readiness` com:

```json
{"ok":true,"data":{"status":"READY","projectConfigured":true,"authReachable":true,"firestoreReachable":true,"secretsExposed":false}}
```

Interpretação permitida:
- projeto Firebase configurado no runtime: VALIDADO;
- Firebase Authentication alcançável pelo backend em produção: VALIDADO;
- Firestore alcançável pelo backend em produção: VALIDADO;
- endpoint de readiness sem exposição de segredos: VALIDADO;
- autenticação funcional de usuário real: AINDA NÃO VALIDADA;
- membership Firestore funcional: AINDA NÃO VALIDADO;
- isolamento tenant A/B real: AINDA NÃO VALIDADO.

## Fora de escopo desta etapa estrutural
- inventar ou versionar service-account JSON;
- declarar Firebase real integralmente validado sem chamada externa funcional bem-sucedida;
- criar dados de clientes reais;
- liberar tráfego comercial.

## Gate externo para fechamento operacional
1. projeto Firebase real identificado — PASS;
2. credencial de workload/service account injetada fora do Git — PASS;
3. Firebase Auth habilitado — PASS;
4. Firestore criado no projeto correto — PASS;
5. smoke test real de token Firebase aprovado — PENDENTE;
6. leitura/escrita controlada em Firestore aprovada — PENDENTE;
7. teste real de tenant A não acessar tenant B aprovado — PENDENTE;
8. evidências registradas sem segredos — PARCIAL, EM ANDAMENTO.

## Próxima execução autorizada
Executar validação funcional ponta a ponta:
1. criar ou usar usuário de teste no Firebase Authentication sem compartilhar senha;
2. obter o `authUserId`/UID do usuário;
3. criar membership controlada na coleção `users` do Firestore com `authUserId`, `tenantId`, `role` e `status=ACTIVE`;
4. autenticar pelo frontend para que o backend valide um ID token real e emita sessão HttpOnly;
5. chamar `GET /api/tenancy/context` com `x-tenant-id` autorizado e confirmar sucesso;
6. repetir com outro `x-tenant-id` sem membership e confirmar `TENANT_ACCESS_DENIED`;
7. executar uma operação tenant-scoped existente para provar leitura/escrita Firestore sob o contexto autorizado;
8. registrar as evidências finais e fechar OP-020 somente após todos os gates PASS.