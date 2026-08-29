# FIREBASE REAL ACTIVATION RUNBOOK — AI SALES SAAS / VENDEDOR IA

## Regra de segurança
Nenhuma chave privada, service-account JSON, access token ou segredo deve ser salvo no GitHub. Em ambiente Google Cloud, preferir identidade do workload/service account anexada ao runtime. Fora dele, usar Application Default Credentials fornecidas pelo ambiente/secret manager.

## Projeto Firebase
Criar ou selecionar um projeto exclusivo do ambiente de produção. Registrar somente o `FIREBASE_PROJECT_ID` como configuração não secreta. Confirmar manualmente que o projeto selecionado é o projeto correto antes de qualquer escrita.

## Authentication
1. habilitar Firebase Authentication;
2. configurar somente os provedores de login aprovados para a V1;
3. configurar domínios autorizados da aplicação;
4. obter um ID token de usuário de teste;
5. validar o fluxo backend `/api/auth/login` com o token real;
6. confirmar que token inválido/revogado falha fechado.

## Firestore
1. criar Firestore no projeto correto e região aprovada;
2. não carregar dados reais durante o smoke inicial;
3. criar tenant e usuário/membership exclusivamente de teste;
4. validar leitura/escrita controlada pelos adapters existentes;
5. verificar índices solicitados pelo Firestore e versionar a definição quando necessária;
6. confirmar isolamento tenant A x tenant B antes de piloto.

## Modelo mínimo de membership para smoke
Collection: `users`.
Campos exigidos pelo adapter atual:
- `authUserId`: UID real do Firebase Auth;
- `tenantId`: tenant de teste;
- `role`: papel não vazio;
- `status`: `ACTIVE`.

## Evidências mínimas
Registrar sem segredos:
- data/hora;
- commit implantado;
- project ID;
- ambiente;
- resultado Auth real;
- resultado Firestore real;
- resultado isolamento multi-tenant;
- responsável humano pela validação.

## Critério de conclusão
OP-020 só pode ser declarado VALIDADO EXTERNAMENTE quando Auth + Firestore + isolamento multi-tenant tiverem sido exercitados contra o projeto real. CI e testes mock/estruturais não substituem esse gate.
