# PROTOCOLO DE EXECUÇÃO — GOOGLE AI STUDIO BUILD MODE — v1.0

## 1. Objetivo
Impedir drift arquitetural, perda de contexto e improvisação do executor.

## 2. Papéis
- Diretor: autoridade final.
- Arquiteto/Engenheiro Sênior: especifica e revisa.
- Google AI Studio / Build Agent / Antigravity: executor técnico.

## 3. Ambiente oficial V1
- Web App/PWA Mobile First;
- React no frontend;
- Node.js server-side;
- Firebase/Firestore/Auth somente quando o bloco aprovar;
- secrets somente server-side;
- GitHub como repositório canônico do código;
- deploy em ambiente aprovado posteriormente.

## 4. Regra de ouro
**O executor não decide arquitetura.**

## 5. Ordem obrigatória antes de qualquer tarefa
1. ler `docs/README.md`;
2. ler `docs/00_AUTHORITY_AND_EXECUTION_RULES.md`;
3. ler os documentos canônicos indicados;
4. ler o prompt do bloco autorizado;
5. reportar plano curto antes de implementar quando solicitado.

## 6. Estrutura padrão de prompt de execução
Toda ordem deve conter:
- **A. Contexto Autoritativo**
- **B. Objetivo Único**
- **C. Escopo Autorizado**
- **D. Fora de Escopo**
- **E. Contratos e Regras**
- **F. Critérios de Aceite**
- **G. Proibições**
- **H. Execução**
- **I. Saída Obrigatória**

## 7. Granularidade
Nunca usar “crie todo o aplicativo”. Trabalhar por blocos pequenos e verificáveis.

## 8. Ciclo de execução
`READ → PLAN → IMPLEMENT → BUILD → TEST → REVIEW → FIX → VALIDATE → REPORT`

Commit e próximo bloco somente após autorização.

## 9. Controle de drift
Conflito com arquitetura/documentação deve ser reportado, não resolvido silenciosamente. Melhorias fora do escopo são sugestões, não implementação.

## 10. GitHub
Fluxo esperado:
`AI Studio/Executor → diff → build/test → revisão → commit/push → GitHub`

Antes de sobrescrever alterações externas, o executor deve sincronizar e resolver conflitos conscientemente.

## 11. Segurança
- Gemini e outros provedores somente por backend e interfaces aprovadas;
- secrets nunca hardcoded;
- pagamentos/webhooks validados server-side;
- isolamento tenant obrigatório;
- logs sem segredos;
- idempotência em operações críticas.

## 12. IA do produto
Preservar `Universal AI Provider Interface`. O fato de o ambiente usar Gemini/Google não autoriza acoplamento do domínio ao Gemini.

## 13. Definition of Done
A tarefa só pode ser marcada como concluída quando escopo implementado, build válido, testes pertinentes executados, segurança/tenant preservados e relatório final honesto entregue.

## 14. Hierarquia
1. decisão explícita do Diretor;
2. Arquitetura Oficial / ADRs;
3. Documento Mestre;
4. System Design / contratos;
5. requisitos / modelo de dados;
6. plano de implementação;
7. tarefa atual;
8. sugestões do executor.

## 15. Princípio final
**Google AI Studio é executor de engenharia, não proprietário do produto nem autoridade arquitetural.**
