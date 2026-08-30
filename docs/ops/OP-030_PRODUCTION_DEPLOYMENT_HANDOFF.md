# OP-030 — Production Deployment Handoff

## Estado
DEPLOY EXTERNO EXECUTADO / AGUARDANDO SMOKE E VALIDAÇÃO FUNCIONAL.

## Fonte validada
Branch: `main`
Commit funcional validado: `3f7336ad968626c92f114203acdf35df5bd65ed7`
Workflow: Project Validation
Run: `33285510525`
Resultado: SUCCESS em Build, Typecheck, Tests, Runtime security boundaries e Production Docker smoke test.

## Destino
- Google Cloud project: `ai-sales-saas-vendedor-ia-prod`
- Cloud Run service: `ai-sales-saas-vendedor-ia`
- Region: `southamerica-east1`
- Runtime service account: `firebase-adminsdk-fbsvc@ai-sales-saas-vendedor-ia-prod.iam.gserviceaccount.com`

## Regra de deploy
Não alterar nem copiar segredos para o repositório.
Preservar a configuração existente do serviço e o Secret Manager já configurado.

## Comando recomendado a partir de uma cópia atualizada da main
```bash
gcloud run deploy ai-sales-saas-vendedor-ia \
  --source . \
  --project ai-sales-saas-vendedor-ia-prod \
  --region southamerica-east1 \
  --service-account firebase-adminsdk-fbsvc@ai-sales-saas-vendedor-ia-prod.iam.gserviceaccount.com \
  --allow-unauthenticated
```

## Smoke pós-deploy
Endpoint:
`https://ai-sales-saas-vendedor-ia-1005722045740.southamerica-east1.run.app/api/health`

Esperado:
- HTTP 200;
- `status: ok`;
- tenant isolation ativo;
- secrets server-side only.

## Validação externa obrigatória da OP-030
1. abrir a aplicação de produção;
2. autenticar com o usuário de teste já validado;
3. confirmar que o workspace abre sem manipulação manual de headers;
4. confirmar descoberta automática do tenant autorizado;
5. confirmar dashboard comercial tenant-scoped;
6. confirmar que ausência de membership ativa falha fechado;
7. não declarar OP-030 fechada antes dessa evidência.

## Evidência de deploy externo
Executado em 2026-08-29 a partir da cópia local em `C:\ai-sales-saas-vendedor-ia`.

- branch: `main`;
- HEAD implantado: `6f975509d35a50c2e3026d5e7ba898ac6ca63a8d`;
- projeto: `ai-sales-saas-vendedor-ia-prod`;
- região: `southamerica-east1`;
- revisão criada: `ai-sales-saas-vendedor-ia-00040-cqt`;
- tráfego: 100% na nova revisão;
- service URL informado pelo Cloud Run: `https://ai-sales-saas-vendedor-ia-1005722045740.southamerica-east1.run.app`;
- build, criação da revisão, roteamento de tráfego e IAM: concluídos com sucesso.

## Próximo gate
Executar smoke externo de `/api/health` e, em seguida, validar login → descoberta automática de tenant → workspace → dashboard. A OP-030 permanece aberta até essas evidências.
