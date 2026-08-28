# AI SALES SAAS — VENDEDOR IA — DOCUMENTAÇÃO OPERACIONAL

**Status:** canônico operacional do repositório.  
**Fonte mestre externa:** Google Drive.  
**Código canônico durável:** este repositório GitHub.  

## Hierarquia de autoridade

1. **Diretor/Proprietário humano** — autoridade final sobre produto, arquitetura, escopo e promoção de mudanças críticas.
2. **Arquiteto/Engenheiro Sênior (ChatGPT)** — especifica arquitetura, System Design, requisitos, contratos, critérios de aceite, tarefas e auditoria.
3. **Executor de código (Google AI Studio / Antigravity ou outro agente aprovado)** — implementa somente o escopo explicitamente autorizado.

Nenhum executor pode redefinir produto, arquitetura ou escopo por conta própria.

## Ordem obrigatória de leitura para qualquer IA executora

1. `docs/00_AUTHORITY_AND_EXECUTION_RULES.md`
2. `docs/MASTER.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SYSTEM_DESIGN.md`
5. `docs/REQUIREMENTS.md`
6. `docs/TECHNICAL_CONTRACTS.md`
7. `docs/DATA_MODEL.md`
8. `docs/IMPLEMENTATION_PLAN.md`
9. `docs/AI_STUDIO_EXECUTION_PROTOCOL.md`
10. tarefa/prompt do bloco atualmente autorizado em `docs/prompts/`

## Regra de conflito

Em caso de conflito, prevalece a seguinte ordem:

1. decisão explícita do Diretor;
2. Arquitetura Oficial e ADRs aprovados;
3. Documento Mestre;
4. System Design e contratos;
5. requisitos/modelo de dados;
6. plano de implementação;
7. tarefa específica do bloco;
8. sugestão do executor.

Se houver dúvida ou conflito real, o executor **deve parar e reportar**, nunca improvisar.

## Estado inicial

O repositório foi criado para receber o projeto Web Full-Stack/PWA. A implementação deve ser incremental, começando pelo `BLK-000 — Repository & Governance Foundation` quando houver autorização expressa.
