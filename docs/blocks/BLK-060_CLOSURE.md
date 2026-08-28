# BLK-060 — Conversations — Closure

**Status:** IMPLEMENTADO / TESTADO / VALIDADO / FECHADO

## Escopo entregue
- `Conversation` tenant-scoped vinculada a `Customer` do mesmo tenant.
- `Message` tenant-scoped vinculada à conversa e ao cliente.
- histórico ordenado por `occurredAt`.
- atualização consistente de `lastMessageAt`, inclusive para importação de histórico anterior à criação local da conversa.
- modos estruturais de atendimento `AI`, `HANDOFF` e `HUMAN` sem perda de histórico.
- deduplicação básica por `externalConversationId` e `externalMessageId` dentro do tenant.
- validação de direção, remetente, tipo, conteúdo e timestamp de mensagem.
- repositories abstratos e adapters Firestore.
- API `/api/conversations` protegida por autenticação e autorização tenant-scoped.

## Segurança e isolamento
- criação de conversa exige Customer existente no mesmo tenant.
- consulta de conversa e histórico de outro tenant retorna `CONVERSATION_NOT_FOUND`.
- a rota não aceita requisição sem sessão válida, mesmo com `x-tenant-id` forjado.
- nenhum segredo novo foi introduzido.

## Validação executada
GitHub Actions `Project Validation`, run `33217546133`:
- instalação de dependências: PASS.
- build: PASS.
- typecheck: PASS.
- testes: **36/36 PASS em 6 arquivos**.
- runtime health: PASS com `block = BLK-060`.
- isolamento/autorização runtime da rota `/api/conversations`: PASS, requisição não autenticada bloqueada com HTTP 401 / `SESSION_REQUIRED`.

## Correção durante validação
A primeira execução detectou que `lastMessageAt` permanecia com o horário de criação quando o primeiro evento importado possuía timestamp histórico anterior. O serviço foi corrigido para derivar o primeiro `lastMessageAt` da primeira mensagem persistida e depois preservar o maior timestamp do histórico. A validação completa subsequente passou.

## Limitações deliberadas
- nenhum modelo de IA foi integrado neste bloco.
- nenhum canal WhatsApp real foi integrado; `WHATSAPP` existe apenas como valor de domínio preparatório.
- envio externo de mensagens pertence ao BLK-120.
- lógica inteligente de leitura de histórico pertence ao BLK-070 e blocos comerciais posteriores.
- Firestore real permanece dependente da configuração externa já documentada do projeto.

## Dependências
Nenhuma nova dependência npm foi adicionada.

## Fora de escopo preservado
Não foram implementados AI Provider, Leads, Sales Engine, Follow-up, Recovery, WhatsApp adapter, Quotes, Payments, Billing ou Analytics.

## Resultado
BLK-060 atende ao objetivo canônico de `Conversation`, `Message`, histórico confiável e handoff estrutural, preservando os gates de arquitetura, tenant, segurança, teste, documentação e Git.
