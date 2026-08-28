# AI SALES SAAS — VENDEDOR IA

Plataforma comercial de IA para atendimento, vendas, follow-up, recuperação de oportunidades e aumento de receita.

## Status

Projeto em construção incremental. A arquitetura, requisitos, contratos, modelo de dados e plano de implementação foram definidos antes da programação. Os blocos BLK-000 e BLK-010 estabeleceram a fundação técnica; o avanço seguinte depende de autorização explícita do Diretor.

## Governança

A documentação operacional obrigatória está em [`/docs`](./docs/README.md).

Qualquer agente, ferramenta ou desenvolvedor deve ler `docs/README.md` e seguir a ordem de autoridade definida ali antes de modificar o projeto.

### Hierarquia

1. Diretor/Proprietário — autoridade humana final.
2. ChatGPT — Arquiteto/Engenheiro Sênior/Executor técnico dentro do escopo autorizado.
3. Ferramentas auxiliares — sem autoridade sobre arquitetura ou produto.

O GitHub é a fonte canônica operacional do código e do histórico técnico.

Google AI Studio / Antigravity não integra mais o fluxo oficial de desenvolvimento deste projeto.

## Protocolo de execução

O protocolo vigente está em:

[`docs/EXECUTION_PROTOCOL.md`](./docs/EXECUTION_PROTOCOL.md)

O desenvolvimento segue o ciclo:

`READ → PLAN → IMPLEMENT → BUILD → TEST → REVIEW → FIX → VALIDATE → REPORT`

Nenhum resultado é declarado como testado ou validado sem evidência real.

## Arquitetura-alvo V1

- Web App/PWA Mobile First;
- React;
- Node.js server-side;
- SaaS multitenant;
- persistência desacoplada por Repository Interfaces;
- Universal AI Provider Interface;
- Payment Provider Interface;
- Channel Interface;
- GitHub como repositório canônico do código.

## Posicionamento

**PARE DE PERDER VENDAS.**
