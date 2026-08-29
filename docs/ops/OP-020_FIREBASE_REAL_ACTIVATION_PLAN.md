# OP-020 — Firebase/Auth/Firestore Real Activation

## Estado
EM EXECUÇÃO — infraestrutura Firebase real, autenticação funcional, sessão e isolamento multi-tenant já validados em produção. Falta apenas concluir e registrar o smoke test tenant-scoped de leitura/escrita Firestore antes do fechamento operacional.

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

## Evidência externa obtida

### Readiness Firebase real
Ambiente real de produção respondeu ao probe seguro `/api/operations/firebase-readiness` com:

```json
{"ok":true,"data":{"status":"READY","projectConfigured":true,"authReachable":true,"firestoreReachable":true,"secretsExposed":false}}
```

Validado:
- projeto Firebase configurado no runtime;
- Firebase Authentication alcançável pelo backend em produção;
- Firestore alcançável pelo backend em produção;
- endpoint de readiness sem exposição de segredos.

### Autenticação funcional e sessão real
Usuário de teste autenticado pelo frontend Firebase Auth e sessão provider-neutral HttpOnly emitida pelo backend. `GET /api/auth/session` confirmou sessão autenticada e UID Firebase real, sem uso ou exposição de senha.

Status: VALIDADO EXTERNAMENTE.

### Membership Firestore real
Foi criada membership controlada na coleção `users` para o usuário de teste, tenant `tenant-op020-a`, status `ACTIVE` e role `OWNER`. O backend localizou o registro real no Firestore e o `GET /api/tenancy/context` retornou:

- HTTP `200`;
- `tenantId = tenant-op020-a`;
- `userId = op020-user-test`;
- `role = OWNER`.

Status: VALIDADO EXTERNAMENTE.

### Isolamento tenant A/B real
Com a mesma sessão autenticada:

- `x-tenant-id: tenant-op020-a` → HTTP `200`, acesso permitido;
- `x-tenant-id: tenant-op020-b` → HTTP `403`, `TENANT_ACCESS_DENIED`.

Status: VALIDADO EXTERNAMENTE. Cross-tenant fail-closed confirmado em produção.

## Incidente encontrado e correção
A validação externa encontrou um `403 TENANT_ACCESS_DENIED` inesperado para o Tenant A. A investigação comprovou que Auth, sessão e Firestore estavam funcionais, mas a resolução da membership precisava de diagnóstico e normalização mais robustos. Foram adicionados probes autenticados temporários, testes de regressão e normalização segura da leitura de campos, preservando fail-closed. Após a correção, o Tenant A retornou `200` com `OWNER` e o Tenant B permaneceu bloqueado com `403`.

## Fora de escopo desta etapa estrutural
- inventar ou versionar service-account JSON;
- criar dados de clientes reais;
- liberar tráfego comercial;
- declarar piloto comercial validado.

## Gate externo para fechamento operacional
1. projeto Firebase real identificado — PASS;
2. credencial de workload/service account injetada fora do Git — PASS;
3. Firebase Auth habilitado — PASS;
4. Firestore criado no projeto correto — PASS;
5. smoke test real de token Firebase aprovado — PASS;
6. leitura/escrita controlada em Firestore aprovada — PENDENTE;
7. teste real de tenant A não acessar tenant B aprovado — PASS;
8. evidências registradas sem segredos — PASS PARCIAL; falta anexar o resultado do smoke tenant-scoped final.

## Próxima execução autorizada
Executar uma operação tenant-scoped existente no catálogo para provar leitura e escrita reais no Firestore sob o contexto autorizado. Se o POST e o GET passarem e o objeto persistido voltar vinculado exclusivamente a `tenant-op020-a`, registrar a evidência, remover/fechar qualquer diagnóstico temporário que não deva permanecer exposto e fechar formalmente a OP-020 como VALIDADA EXTERNAMENTE.