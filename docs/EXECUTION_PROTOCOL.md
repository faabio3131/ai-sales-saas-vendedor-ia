# PROTOCOLO DE EXECUÇÃO DIRETA — CHATGPT + GITHUB — v1.0

## 1. Objetivo
Estabelecer o fluxo oficial de desenvolvimento do AI Sales SaaS — Vendedor IA com execução direta por ChatGPT e GitHub como estado técnico canônico.

## 2. Papéis
- Diretor/Proprietário: autoridade humana final.
- ChatGPT: Arquiteto, Engenheiro Sênior e Executor técnico autorizado.
- GitHub: fonte canônica operacional de código, histórico e documentação executável.
- Ferramentas auxiliares: apoio técnico sem autoridade sobre produto ou arquitetura.

## 3. Ambiente oficial V1
- Web App/PWA Mobile First;
- React no frontend;
- Node.js server-side;
- autenticação, banco e provedores somente nos blocos autorizados;
- secrets somente server-side;
- GitHub como repositório canônico do código;
- deploy em ambiente aprovado posteriormente.

## 4. Regra de ouro
**Nenhuma capacidade de execução autoriza mudança autônoma de arquitetura, escopo ou produto.**

## 5. Ordem obrigatória antes de qualquer tarefa
1. ler `docs/README.md`;
2. ler `docs/00_AUTHORITY_AND_EXECUTION_RULES.md`;
3. ler os documentos canônicos aplicáveis;
4. identificar o bloco autorizado;
5. inspecionar o estado real do GitHub;
6. formular o plano da alteração;
7. executar somente dentro do escopo aprovado.

## 6. Granularidade
Nunca implementar “o aplicativo inteiro” em uma única operação. Trabalhar por blocos pequenos, rastreáveis e verificáveis.

## 7. Ciclo oficial
`READ → PLAN → IMPLEMENT → BUILD → TEST → REVIEW → FIX → VALIDATE → REPORT`

Quando build/test não puder ser executado por limitação real do ambiente, registrar explicitamente a limitação. Nunca declarar PASS sem execução.

O próximo bloco somente inicia após autorização do Diretor.

## 8. GitHub
Fluxo oficial:
`GitHub atual → leitura/diagnóstico → alteração autorizada → revisão → testes disponíveis → commit → releitura/verificação do GitHub → relatório`

Cada alteração deve:
- preservar histórico;
- usar mensagem de commit descritiva;
- evitar modificações fora do escopo;
- ser relida após gravação quando tecnicamente possível;
- distinguir código salvo de código efetivamente testado em runtime.

## 9. Controle de drift
Conflito com arquitetura/documentação deve ser reportado e submetido ao Diretor. Melhorias fora do escopo são propostas antes de implementação.

## 10. Segurança
- provedores de IA somente por backend e interfaces aprovadas;
- secrets nunca hardcoded;
- pagamentos e webhooks validados server-side;
- isolamento tenant somente pode ser declarado após autenticação/autorização e controles correspondentes realmente existirem;
- logs sem segredos;
- idempotência em operações críticas.

## 11. IA do produto
Preservar `Universal AI Provider Interface`. Nenhum provedor externo pode contaminar o domínio com dependência direta.

## 12. Definition of Done
Uma tarefa somente pode ser marcada como concluída quando:
- o escopo autorizado estiver implementado;
- o estado salvo no GitHub tiver sido verificado;
- build/typecheck/testes pertinentes tiverem sido executados quando o ambiente permitir;
- qualquer limitação de validação estiver explicitamente registrada;
- segurança e contratos aplicáveis estiverem preservados;
- o relatório final refletir exatamente as evidências disponíveis.

## 13. Hierarquia de decisão
1. decisão explícita do Diretor;
2. Arquitetura Oficial / ADRs;
3. Documento Mestre;
4. System Design / contratos;
5. requisitos / modelo de dados;
6. plano de implementação;
7. tarefa atual;
8. sugestão técnica do executor.

## 14. Princípio final
**O Diretor decide. O ChatGPT projeta e executa dentro da autorização. A arquitetura limita a execução. O GitHub registra a verdade operacional.**
