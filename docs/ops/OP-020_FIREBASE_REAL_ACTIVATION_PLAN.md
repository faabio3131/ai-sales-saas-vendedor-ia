# OP-020 — Firebase/Auth/Firestore Real Activation

## Estado
EM EXECUÇÃO — preparação estrutural autorizada. Validação externa real permanece pendente até existir projeto/credenciais Firebase no ambiente de execução.

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

## Fora de escopo desta etapa estrutural
- inventar ou versionar service-account JSON;
- declarar Firebase real validado sem chamada externa bem-sucedida;
- criar dados de clientes reais;
- liberar tráfego comercial.

## Gate externo para fechamento operacional
1. projeto Firebase real identificado;
2. credencial de workload/service account injetada fora do Git;
3. Firebase Auth habilitado;
4. Firestore criado no projeto correto;
5. smoke test real de token Firebase aprovado;
6. leitura/escrita controlada em Firestore aprovada;
7. teste real de tenant A não acessar tenant B aprovado;
8. evidências registradas sem segredos.
