# PROMPT OFICIAL — BLK-000 — REPOSITORY & GOVERNANCE FOUNDATION — v1.0

**Status:** pronto para execução somente após autorização expressa do Diretor.

## A. CONTEXTO AUTORITATIVO
Você é o executor técnico do projeto **AI SALES SAAS — VENDEDOR IA**.

Antes de qualquer alteração, leia integralmente:
1. `docs/README.md`
2. `docs/00_AUTHORITY_AND_EXECUTION_RULES.md`
3. `docs/MASTER.md`
4. `docs/ARCHITECTURE.md`
5. `docs/SYSTEM_DESIGN.md`
6. `docs/REQUIREMENTS.md`
7. `docs/TECHNICAL_CONTRACTS.md`
8. `docs/DATA_MODEL.md`
9. `docs/IMPLEMENTATION_PLAN.md`
10. `docs/AI_STUDIO_EXECUTION_PROTOCOL.md`

A documentação é autoridade. Você não pode redefinir produto, arquitetura ou escopo.

## B. OBJETIVO ÚNICO
Estabelecer a **fundação técnica e de governança do repositório** para permitir que os próximos blocos sejam implementados de forma incremental, testável e segura.

Este bloco NÃO implementa funcionalidades comerciais.

## C. ESCOPO AUTORIZADO

1. Inspecionar o projeto/repositório atual antes de alterar qualquer arquivo.
2. Confirmar framework, package manager, TypeScript, scripts e estrutura existentes.
3. Preservar os documentos em `/docs` sem reescrever seu conteúdo arquitetural.
4. Organizar estrutura mínima de projeto coerente com React + Node.js server-side, somente se ainda não existir e sem implementar domínio comercial.
5. Configurar TypeScript estrito quando aplicável ao template real.
6. Configurar scripts mínimos e claros para:
   - desenvolvimento;
   - build;
   - typecheck;
   - testes;
   - lint, somente se a stack/template suportar de forma simples.
7. Criar um health check técnico mínimo no backend, se o runtime server-side já estiver disponível no ambiente.
8. Criar uma página/tela técnica mínima de foundation somente se necessário para validar o build, sem UI comercial.
9. Criar estrutura inicial de diretórios sem lógica de negócio, seguindo a arquitetura, apenas na medida necessária para preparar os próximos blocos.
10. Criar testes mínimos da própria foundation/configuração quando aplicável.
11. Garantir `.gitignore` apropriado para Node/React, caches, builds, secrets e arquivos locais.
12. Criar `.env.example` apenas com nomes de variáveis e valores fictícios; nunca secrets reais.
13. Confirmar que nenhum segredo está versionado.
14. Executar build, typecheck e testes disponíveis.
15. Gerar relatório final.

## D. FORA DE ESCOPO
É proibido neste bloco implementar ou configurar funcionalmente:

- Firebase Authentication;
- Firestore funcional;
- tenant/tenancy;
- Customer/CRM;
- produtos/serviços comerciais;
- Conversation Engine;
- Gemini ou outro provider de IA;
- Universal AI Provider implementation real;
- Lead Intelligence;
- Sales Engine;
- Follow-up;
- Sales Recovery;
- WhatsApp;
- pagamentos/Pix;
- quotes;
- upsell/cross-sell;
- billing;
- dashboard comercial;
- automações comerciais;
- qualquer integração externa real.

Não instalar SDKs desses provedores neste bloco.

## E. CONTRATOS E REGRAS
- Web App/PWA é a direção do produto; não converter para Android nativo.
- React é frontend previsto.
- Node.js server-side é backend previsto.
- O domínio futuro não pode conhecer SDKs externos.
- Multitenancy é obrigatório no produto, mas ainda não deve ser implementado neste bloco.
- Secrets sempre server-side e nunca versionados.
- Não criar infraestrutura distribuída.
- Não alterar documentos canônicos para justificar decisões de implementação.

## F. CRITÉRIOS DE ACEITE
BLK-000 só pode ser reportado como concluído se:

1. ambiente atual tiver sido inspecionado e descrito;
2. estrutura foundation estiver coerente e mínima;
3. build passar;
4. typecheck passar se configurado;
5. testes foundation passarem se existentes/configurados;
6. não houver secrets versionados;
7. `/docs` permanecer íntegro;
8. nenhuma funcionalidade de blocos futuros tiver sido implementada;
9. relatório final listar exatamente o que mudou;
10. qualquer limitação real do ambiente for explicitamente declarada.

## G. PROIBIÇÕES
- Não executar “melhorias” fora do escopo.
- Não escolher Firebase/Gemini/WhatsApp/pagamentos agora.
- Não criar mock comercial amplo apenas para parecer que o produto existe.
- Não reescrever toda a aplicação sem necessidade comprovada.
- Não declarar testes não executados.
- Não fazer commit/push automático se a ordem recebida não autorizar explicitamente.

## H. EXECUÇÃO
Use o ciclo:

`READ → INSPECT → PLAN → IMPLEMENT → BUILD → TEST → REVIEW → FIX → VALIDATE → REPORT`

Se encontrar conflito entre o projeto atual e a documentação, PARE e reporte antes de modificar arquitetura.

## I. SAÍDA OBRIGATÓRIA
Entregue um relatório com:

1. **Ambiente encontrado** — framework, runtime, package manager, TypeScript, scripts.
2. **Arquivos criados**.
3. **Arquivos alterados**.
4. **Dependências adicionadas/removidas** e justificativa.
5. **Build executado** — comando e resultado.
6. **Typecheck/lint executados** — comando e resultado.
7. **Testes executados** — comando, quantidade e resultado real.
8. **Security check** — secrets e `.gitignore`.
9. **Desvios** — qualquer ponto em que o ambiente impediu o plano.
10. **Riscos e pendências**.
11. Confirmação explícita: **nenhuma funcionalidade comercial fora do BLK-000 foi implementada**.
12. Status final: `PRONTO PARA REVISÃO` ou `BLOQUEADO`, com motivo.

**Não avance para BLK-010 sem nova autorização.**
