# T07 — Runbook técnico da autonomia comercial governada

## API sob autenticação + membership
- `GET /api/autonomy/units/:unitId/policy` — visualizar política da unidade autorizada; sem política, `ASSIST`/allowlist vazia.
- `PUT /api/autonomy/units/:unitId/policy` — OWNER/ADMIN; `expectedVersion`, `mode`, `allowedTools`, `maxOrderMinor`, `maxPaymentMinor`.
- `POST /api/autonomy/units/:unitId/approvals` — OWNER/ADMIN; `command` completo sem approvalId, `granteeUserId`, `maxAmountMinor`, `expiresAt` (prazo máximo 1h).
- `GET /api/autonomy/units/:unitId/approvals/:id` — OWNER/ADMIN; consulta aprovação.
- `POST /api/autonomy/units/:unitId/approvals/:id/revoke` — OWNER/ADMIN; revoga aprovação ainda válida.
- `POST /api/autonomy/units/:unitId/execute` — `{tool,idempotencyKey,payload,approvalId?}`, allowlist fechada; recibo de execução.

## Exemplo estrutural (não enviar transação sem dados reais aprovados)
1. OWNER configura `ASSIST` inicialmente, depois avalia upgrade para `COPILOT` ou `AUTONOMOUS_GOVERNED`.
2. Propor `ORDER_DRAFT` com `customerId`, catálogo versionado, `lines` e retirada ou entrega (taxa/CEP validados pelo T03/T06). O total é calculado no backend, nunca aceito por texto da IA.
3. Confirmar somente com `ORDER_CONFIRM` e `confirmation:{kind:'CUSTOMER_MESSAGE', evidenceRef:'conversation:...', totalMinor:<valor calculado>}`. O texto exato deve corresponder ao UUID do pedido e total, e o registro de origem deve ter assinatura do WhatsApp, cliente/tenant/unidade corretos e avaliação de risco liberada.
4. `PAYMENT_CREATE` usa os métodos oficiais habilitados do estabelecimento; o recebimento não é inferido da criação do Pix. A confirmação oficial entra pelos mecanismos de T04 e o estado financeiro é persistido.
5. `PRODUCTION_RELEASE` confere cliente, valor, política de pagamento, área de entrega e modo exclusivo de operação; devolve fila nativa ou `AWAITING_ACK` no integrado.
6. Produção e notificações evoluem por eventos reais persistidos pelo T06; o gateway não inventa status.
7. `RECOVERY_PREPARE` exige consentimento explícito `OPT_IN` e prova de origem; `OPT_OUT` ou ausência de prova bloqueia a ação, não envia mensagem.

## Recuperação de falhas
- Se o recibo estiver `REVIEW_REQUIRED` ou `RESERVED` após falha/crash, **não reenvie o mesmo pagamento nem crie segunda cobrança**. Um operador deve investigar PSP e a operação original, conciliar e usar os processos T04/T06.
- Repetir a mesma chave com payload divergente gera conflito; não usar chaves aleatórias para forçar outra cobrança após timeout.
- `AUTONOMY_RISK_ESCALATION_REQUIRED`: encaminhar para atendente e tratar allergênicos/disputa/descontos; aprovação humana não dispensa limites monetários, assinaturas, configuração do modo e fonte de verdade.
- Falta de avaliação de risco, provedor assinado ou consentimento é **NO_GO**, não autorização silenciosa.
- Revogar consentimento e aprovação antes de retomar uma ação comercial; não modificar o estado direto no Firestore fora dos serviços canônicos.

## Testes e implantação
Executar `npm run typecheck`, `npm test`, `npm run build`, testes Python do cognitive service, Docker e smoke da CI. A tabela e as evidências exatas do commit certificado ficam em `docs/T07_CLOSURE_CERTIFICATION.md`.

**Integração real T08:** somente após T07 certificada e autorização do Diretor: cadastrar a pizzaria, configurar canal/PSP reais, vincular tenant/unidade ao número oficial por configuração server-side, instalar webhooks assinados, criar registros de consentimento e provas por adaptador, aplicar índices e validar 10/10 jornadas reais com backup/rollback e aceite humano.
