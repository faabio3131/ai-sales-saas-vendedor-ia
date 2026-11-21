# AI SALES SAAS — VENDEDOR IA — DOCUMENTAÇÃO OPERACIONAL

**Status:** canônico operacional do repositório.  
**Fonte mestre externa:** Google Drive.  
**Código e documentação operacional canônicos:** este repositório GitHub.  

## Hierarquia de autoridade

1. **Diretor/Proprietário humano** — autoridade final sobre produto, arquitetura, escopo e promoção de mudanças críticas.
2. **ChatGPT — Arquiteto/Engenheiro Sênior/Executor técnico** — especifica arquitetura, System Design, requisitos, contratos, critérios de aceite, implementa o escopo autorizado, revisa, testa quando o ambiente permitir, audita e mantém o estado técnico no GitHub.
3. **Ferramentas auxiliares aprovadas** — ambientes, agentes, provedores e integrações usados somente como instrumentos técnicos, sem autoridade própria sobre arquitetura ou produto.

Google AI Studio / Antigravity não integra mais o fluxo oficial de desenvolvimento deste projeto.

A acumulação dos papéis de arquitetura e execução pelo ChatGPT não altera a autoridade do Diretor. Nenhuma mudança de arquitetura, escopo, stack, modelo comercial ou avanço de bloco pode ser promovida autonomamente.

## Ordem obrigatória de leitura antes de modificar o projeto

1. `docs/00_AUTHORITY_AND_EXECUTION_RULES.md`
2. `docs/MASTER.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SYSTEM_DESIGN.md`
5. `docs/REQUIREMENTS.md`
6. `docs/TECHNICAL_CONTRACTS.md`
7. `docs/DATA_MODEL.md`
8. `docs/IMPLEMENTATION_PLAN.md`
9. `docs/EXECUTION_PROTOCOL.md`
10. `CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA.md` — roteiro das evoluções T01–T12, decisões Food Service Pack, dois modos de operação e gates sequenciais;
11. tarefa/bloco atualmente autorizado e ADRs aplicáveis.

## Regra de conflito

Em caso de conflito, prevalece a seguinte ordem:

1. decisão explícita do Diretor;
2. Arquitetura Oficial e ADRs aprovados;
3. Documento Mestre;
4. System Design e contratos;
5. requisitos/modelo de dados;
6. plano de implementação;
7. tarefa específica do bloco;
8. sugestão técnica do executor.

Se houver dúvida ou conflito real, a execução **deve parar e reportar**, nunca improvisar.

## Regra de evidência

O estado real do GitHub prevalece sobre relatos de ferramentas externas. Não marcar trabalho como testado, validado ou sincronizado sem evidência correspondente.

## Estado atual

A fundação do projeto foi criada nos blocos BLK-000 e BLK-010. O desenvolvimento continua incrementalmente conforme `docs/IMPLEMENTATION_PLAN.md` e somente avança mediante autorização expressa do Diretor.
