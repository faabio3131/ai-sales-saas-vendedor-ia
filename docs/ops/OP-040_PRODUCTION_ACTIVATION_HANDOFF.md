# OP-040 — Production Activation Handoff

## Estado
PRONTO PARA ATIVAÇÃO EXTERNA CONTROLADA / AGUARDANDO CRIAÇÃO DA AUTH KEY GEMINI, SECRET MANAGER E DEPLOY.

## Fonte técnica validada
- branch: `main`;
- HEAD preparado: `b33655d5dc4469788064441b635c4548c6e4de3a`;
- Project Validation run: `33340441847`;
- job: `99334985568`;
- Build: PASS;
- Typecheck: PASS;
- Tests: PASS;
- Runtime security boundaries: PASS;
- Production Docker smoke: PASS.

## Provedor e API aprovados para esta ativação
- provider: Gemini;
- model: `gemini-3.7-flash`;
- API: Interactions API estável `v1`;
- transporte: REST/HTTP atrás de `GeminiTransport`;
- modo: stateless, `store=false`;
- credencial: authorization API key vinculada à service account de runtime.

## Destino
- Google Cloud project: `ai-sales-saas-vendedor-ia-prod`;
- Cloud Run service: `ai-sales-saas-vendedor-ia`;
- region: `southamerica-east1`;
- runtime service account: `firebase-adminsdk-fbsvc@ai-sales-saas-vendedor-ia-prod.iam.gserviceaccount.com`;
- secret planejado: `gemini-api-key`;
- variável secreta runtime: `GEMINI_API_KEY`;
- variável não secreta runtime: `GEMINI_MODEL=gemini-3.7-flash`.

## Regra de segurança
Nunca imprimir, copiar para documentação, commit, chat ou screenshot a string da authorization key.

A chave deve ser criada restrita à API `generativelanguage.googleapis.com` e vinculada à service account de runtime.

## Sequência externa recomendada

### 1. Sincronizar a cópia local
```powershell
git pull origin main
git rev-parse HEAD
```

O HEAD precisa conter pelo menos o commit funcional validado `b33655d5dc4469788064441b635c4548c6e4de3a` ou descendente documental sem mudança funcional.

### 2. Garantir APIs administrativas necessárias
```powershell
gcloud services enable apikeys.googleapis.com generativelanguage.googleapis.com secretmanager.googleapis.com --project ai-sales-saas-vendedor-ia-prod
```

### 3. Criar authorization key Gemini
Usar `gcloud beta services api-keys create` com:
- restrição exclusiva a `generativelanguage.googleapis.com`;
- binding à service account de runtime.

Não exibir a key string em tela durante o fluxo de armazenamento.

### 4. Armazenar a key string no Secret Manager
Secret: `gemini-api-key`.

A service account de runtime deve receber apenas `roles/secretmanager.secretAccessor` nesse secret.

### 5. Deploy não destrutivo
Usar flags de atualização, não `--set-env-vars` / `--set-secrets`, para preservar Firebase e `SESSION_SECRET` existentes.

```powershell
gcloud run deploy ai-sales-saas-vendedor-ia `
  --source . `
  --project ai-sales-saas-vendedor-ia-prod `
  --region southamerica-east1 `
  --service-account firebase-adminsdk-fbsvc@ai-sales-saas-vendedor-ia-prod.iam.gserviceaccount.com `
  --allow-unauthenticated `
  --update-env-vars GEMINI_MODEL=gemini-3.7-flash `
  --update-secrets GEMINI_API_KEY=gemini-api-key:latest
```

## Smoke pós-deploy
1. `GET /api/health` deve continuar 200;
2. login com usuário OWNER autorizado;
3. `GET /api/operations/ai-readiness` com sessão + `x-tenant-id`;
4. readiness deve retornar `READY`, provider `gemini`, model `gemini-3.7-flash`, `secretsExposed=false`;
5. `POST /api/operations/ai-smoke` com sessão + tenant OWNER;
6. smoke deve retornar geração real, provider `gemini`, model real e `generated=true`;
7. nenhuma resposta deve conter a API key.

## Gate negativo
Sem sessão, sem tenant autorizado ou sem role OWNER, a rota de smoke não pode executar geração real.

## Regra de fechamento
Não fechar OP-040 apenas por deploy ou readiness. Exigir evidência de geração real em produção e gate negativo preservado.
