# PRODUCTION DEPLOYMENT RUNBOOK — AI SALES SAAS / VENDEDOR IA

## Objetivo
Executar deploy reproduzível do backend/web em ambiente real sem colocar segredos no repositório.

## Artefato
O repositório possui `Dockerfile` multi-stage. Build, typecheck e testes são executados durante a etapa de build. A imagem runtime contém apenas dependências de produção e `dist`.

## Segredos
Nunca versionar valores reais. Injetar por Secret Manager/serviço equivalente no ambiente de execução.

Variáveis mínimas antes de tráfego real:
- `SESSION_SECRET` com no mínimo 32 caracteres;
- `FIREBASE_PROJECT_ID` real;
- `PUBLIC_APP_URL` HTTPS;
- credencial de pelo menos um provedor de IA aprovado;
- credenciais WhatsApp completas quando tráfego real estiver habilitado.

## Deploy controlado
1. construir imagem a partir de commit Git validado;
2. injetar secrets externamente;
3. iniciar com uma única revisão/instância lógica de teste;
4. validar `/api/health`;
5. validar autenticação e TenantContext com tenant de teste;
6. validar Firestore real sem dados de clientes reais inicialmente;
7. validar provedor de IA em cenário controlado;
8. validar WhatsApp ponta a ponta com número de teste;
9. somente depois liberar piloto real.

## Rollback
Preservar a imagem/revisão anterior. Em caso de falha crítica, interromper tráfego para a revisão nova e restaurar a última revisão validada. Não realizar migração destrutiva de dados como parte do primeiro deploy operacional.

## Regra de verdade
Container e configuração estrutural prontos não significam ambiente de produção validado. A validação real exige credenciais, deploy e testes externos registrados.
