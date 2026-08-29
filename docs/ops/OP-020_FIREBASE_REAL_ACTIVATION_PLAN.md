# OP-020 — Firebase/Auth/Firestore Real Activation

## Estado
VALIDADO EXTERNAMENTE / FECHADO OPERACIONALMENTE.

## Objetivo
Ativar de forma governada o caminho real de Firebase Authentication e Firestore já abstraído no produto, sem versionar segredos e sem confundir prontidão estrutural com validação externa.

## Escopo concluído
- bootstrap Firebase Admin centralizado com Application Default Credentials;
- Firebase Authentication real habilitado e alcançável em produção;
- Firestore real criado e alcançável em produção;
- autenticação funcional de usuário real validada;
- sessão provider-neutral HttpOnly validada;
- membership real em Firestore validada;
- isolamento multi-tenant real validado com tenant autorizado e tenant não autorizado;
- leitura e escrita Firestore reais validadas por API tenant-scoped;
- correções de regressão aplicadas para resolução de membership e persistência do catálogo;
- diagnósticos temporários removidos após a investigação;
- nenhuma credencial ou segredo versionado no repositório.

## Evidência externa obtida

### Readiness Firebase real
O ambiente real de produção respondeu ao probe seguro `/api/operations/firebase-readiness` com estado `READY`, confirmando projeto configurado, Auth alcançável, Firestore alcançável e ausência de exposição de segredos.

### Autenticação funcional e sessão real
Usuário de teste autenticado pelo frontend Firebase Auth. O backend validou o token real e emitiu sessão HttpOnly. `GET /api/auth/session` confirmou sessão autenticada sem uso ou exposição de senha.

Status: PASS / VALIDADO EXTERNAMENTE.

### Membership Firestore real
Membership controlada criada na coleção `users` para o usuário de teste, tenant `tenant-op020-a`, status `ACTIVE` e role `OWNER`.

`GET /api/tenancy/context` com `x-tenant-id: tenant-op020-a` retornou HTTP `200`, `tenantId = tenant-op020-a`, `userId = op020-user-test` e `role = OWNER`.

Status: PASS / VALIDADO EXTERNAMENTE.

### Isolamento tenant A/B real
Com a mesma sessão autenticada:

- `x-tenant-id: tenant-op020-a` → HTTP `200`, acesso permitido;
- `x-tenant-id: tenant-op020-b` → HTTP `403`, `TENANT_ACCESS_DENIED`.

Status: PASS / cross-tenant fail-closed confirmado em produção.

### Escrita Firestore real via API tenant-scoped
`POST /api/catalog` sob `x-tenant-id: tenant-op020-a` retornou HTTP `201` e persistiu o item de smoke test com ID `fa2ffd03-a162-4279-a221-66eb1840f895`, `tenantId = tenant-op020-a`, `type = PRODUCT`, `priceMinor = 100` e `currency = BRL`.

Status: PASS / escrita real validada.

### Leitura Firestore real via API tenant-scoped
`GET /api/catalog/fa2ffd03-a162-4279-a221-66eb1840f895` sob o mesmo contexto retornou HTTP `200` com o mesmo objeto persistido e o mesmo `tenantId`.

Status: PASS / leitura persistida validada.

## Incidentes encontrados e resolvidos

### Resolução de membership
Durante a validação externa, o Tenant A inicialmente retornou `403 TENANT_ACCESS_DENIED`. A investigação comprovou que Auth, sessão e Firestore estavam funcionais. A resolução de membership foi endurecida com normalização segura de campos e testes de regressão, preservando fail-closed. Após a correção, Tenant A retornou `200 / OWNER` e Tenant B permaneceu bloqueado com `403`.

### Escrita de catálogo
O primeiro POST tenant-scoped retornou `500` porque o objeto de catálogo podia conter propriedades opcionais com valor `undefined`, que o Firestore rejeita por padrão. O repositório foi corrigido para reutilizar o bootstrap Firebase central e remover valores `undefined` antes da persistência. O teste de regressão e o teste real de produção passaram.

## Gate externo de fechamento operacional
1. projeto Firebase real identificado — PASS;
2. workload/service account fora do Git — PASS;
3. Firebase Auth habilitado — PASS;
4. Firestore criado no projeto correto — PASS;
5. token Firebase real e sessão backend — PASS;
6. membership Firestore real — PASS;
7. tenant A autorizado — PASS;
8. tenant B não autorizado bloqueado — PASS;
9. escrita Firestore tenant-scoped — PASS;
10. leitura Firestore tenant-scoped — PASS;
11. evidências registradas sem segredos — PASS;
12. diagnósticos temporários removidos — PASS.

## Resultado final
OP-020 — Firebase/Auth/Firestore Real Activation: VALIDADO EXTERNAMENTE / FECHADO OPERACIONALMENTE.

Este fechamento não declara piloto comercial validado, não ativa flags de release e não substitui gates futuros de hardening, observabilidade, menor privilégio IAM ou validação comercial.