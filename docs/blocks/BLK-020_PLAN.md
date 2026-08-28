# BLK-020 — Authentication — Plano de Implementação

**Status:** AUTORIZADO PELO DIRETOR em 2026-08-28.

## Objetivo único
Implementar autenticação inicial e sessão server-side sem antecipar o isolamento/autorização multitenant do BLK-030.

## Decisão técnica
- Firebase Authentication é o primeiro adapter de identidade da V1.
- O backend não depende diretamente do Firebase fora do adapter `FirebaseAuthProvider`.
- O frontend usa Firebase Authentication apenas para obter o ID token do usuário.
- O backend verifica o ID token e emite sua própria sessão HTTP-only assinada.
- A sessão da aplicação é provider-neutral e não contém autoridade de tenant.
- `tenantId`, papéis tenant-scoped e isolamento entre empresas permanecem fora deste bloco e serão implementados no BLK-030.

## Escopo autorizado
- `AuthProviderInterface` e `AuthPrincipal`;
- adapter Firebase de verificação server-side;
- sessão assinada server-side com HMAC SHA-256;
- cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção;
- endpoints de criação, leitura e encerramento de sessão;
- tela mobile-first de login/criação de conta por email/senha;
- configuração via variáveis de ambiente sem segredos hardcoded;
- testes de assinatura, adulteração, expiração/validação e handlers;
- CI/build/typecheck/test/runtime validation.

## Fora de escopo
- criação de Tenant;
- autorização por tenant;
- papéis OWNER/ADMIN/AGENT efetivos;
- Firestore/database de negócio;
- Customers, Catalog, Conversations, AI, WhatsApp, Payments e demais blocos posteriores;
- login social;
- recuperação de senha e MFA nesta primeira entrega.

## Segurança
- `SESSION_SECRET` é segredo server-side e obrigatório para operações de sessão;
- credenciais/senhas nunca transitam pelo backend da aplicação: Firebase Auth as recebe diretamente no cliente;
- ID token é verificado no backend antes de qualquer sessão ser criada;
- erros de provedor são normalizados e não expõem detalhes internos;
- a sessão não concede autoridade de tenant.

## Critérios de aceite
1. Build passa.
2. Typecheck passa.
3. Testes do BLK-010 continuam passando.
4. Testes do BLK-020 passam.
5. Token de sessão adulterado é rejeitado.
6. Identidade enviada pelo cliente não é confiada: o principal vem do provider verificado.
7. Cookie de sessão é `HttpOnly` e seguro em produção.
8. `/api/health` continua funcionando sem Firebase configurado.
9. Nenhuma feature do BLK-030+ é implementada.

## Gate
O BLK-020 só será formalmente fechado após CI reproduzível e revisão do estado remoto.