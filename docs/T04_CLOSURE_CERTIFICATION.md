# T04 — Certificação interna do Order Payment Engine

**Data:** 21/11/2026. **Escopo:** T04 autorizada; T05 permanece com trava humana.
**Estado:** Engenharia funcional concluída e aprovada na CI de referência abaixo.
**Importante:** Certificação interna NÃO equivale a homologação bancária, publicação em Contabo ou ativação da Pizzaria Americana.

## Evidência funcional
- [PR #14](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/14)
- SHA funcional antes do fechamento documental: 704304eb98635479f168f2a932517772b9ba8db3
- [CI cumulativa #44935718242 — SUCCESS](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44935718242)
- **269/269 testes TypeScript (50 arquivos), 7/7 Python, build, typecheck, runtime security boundaries, Compose config gate, Docker Node e Python certificados.** No smoke Node Docker constam 268 PASS + 1 SKIP de dependência externa, coberta por validação HTTP S2S do Python na CI principal.
- CI da main pós-merge deve ser inspecionada no SHA final de integração, sem extrapolar da CI da branch.

## Entregas T04
1. Vínculo atômico entre pedido confirmado e pagamento, com confirmação exata do cliente, autenticação de operador, tenant/unidade, titularidade, total BRL e controle de papel. Política comercial não autoriza CREATE_PAYMENT por mera sugestão da IA.
2. Reserva transacional de pagamento, chave idempotente por tenant/unidade, fingerprint, índice único por pedido, mudança de estado financeiro e outbox na mesma transação Firestore.
3. Pix com adaptadores existentes de Mercado Pago, Efí, Asaas, Pagar.me, Inter, Banco do Brasil e PagBank. Retorno de código copia-e-cola, QR base64 e expiração somente quando comprovados pelo provedor, sem dados inventados. Pré-validação de e-mail e mapeamento de cliente antes da reserva da cobrança.
4. Suporte contratual a links e checkout HTTPS somente para adaptadores que anunciem a capacidade. Os adaptadores Pix-only atuais NÃO foram promovidos artificialmente a adquirentes de cartão online. Nunca aceitar nem armazenar PAN/CVV.
5. PIX_MANUAL continua pendente sem prova bancária. CARD_ON_DELIVERY e CASH_ON_DELIVERY exigem método ativado pelo dono, ator de caixa autorizado, valor integral, recibo não-PAN, atualização auditada e cálculo de troco sobre dinheiro realmente recebido.
6. PSP GET vinculado ao merchant garante conferência de conta beneficiária, ID, valor e referência. Webhooks assinados existentes roteiam pagamentos legados e de pedidos; notificação jamais define status sem consulta oficial. PagBank sem webhook autenticado validado segue por polling.
7. Expiração, liquidação tardia, reentrega duplicada/fora de ordem, falha de PSP e referência divergente tratados com máquina de estados fail-closed. Resultado incerto não dispara nova cobrança; recuperação por OWNER/ADMIN exige PSP GET verificado.
8. Estorno com OWNER/ADMIN, motivo, versão e evento REFUND_PENDING antes de I/O bancário; não reafirmar REFUNDED sem confirmação GET. Escalonamento manual de estorno pendente acima de 24 horas.
9. Outbox transacional, leases/fencing, retries com backoff, DLQ e consumidor de eventos financeiros idempotente para a T05. Produção e entrega permanecem independentes do pagamento.
10. Reconciliador legado preservado; Compose de ciclo de aproximadamente cinco minutos passa a executar reconciliação de cotações, pedidos T04 e outbox, com health marker apenas quando ambas as rotinas são bem-sucedidas. Índices Firestore necessários versionados e sujeitos à aplicação no ambiente real.

## Critérios de aceite (engenharia interna)
- [x] Contratos de adaptadores e vínculo pedido–pagamento testados sem alegar homologação externa de PSP/sandbox.
- [x] Timeout, expiração Pix, confirmação tardia, duplicidade, ordem de webhooks, valor divergente e estornos cobertos.
- [x] Sem confirmação financeira proveniente de mensagem, print, QR ou confiança de LLM.
- [x] Eventos financeiros duráveis não alteram preparo nem entrega; coleta presencial registra ator, papel, prova e fonte operacional.
- [x] PRs bancárias anteriores #8/#9 preservadas, com vínculo OrderPayment, outbox e worker de reconciliação integrados.

## Limites externos explicitamente NÃO certificados
- Nenhum deploy Contabo/Cloud Run nem segredo bancário real, PSP sandbox ou Pix real.
- Nenhum adapter Pix-only foi certificado para checkout online ou estorno real; falta capacidade contratual e homologação de adquirente, mantendo falha segura.
- Webhook PagBank não foi habilitado sem autenticidade oficialmente verificada.
- Firestore transacional foi implementado e testado com doubles determinísticos, não na instância real; os índices versionados precisam ser aplicados.
- O sistema ainda depende da verificação real da origem WhatsApp e dos dados operacionais do piloto na T08.
- Eventos comerciais para a T05 não são demonstração contábil final, receita líquida, nem homologação fiscal.
- **T05 BLOQUEADA** até autorização humana explícita.

## Documentos
- docs/ADR-005_T04_ORDER_PAYMENT_ENGINE.md
- docs/T04_PAYMENT_ENGINE_RUNBOOK.md
- docs/CONTABO_PAYMENT_RECONCILER.md
- deploy/order-payments.firestore-indexes.json
- docs/CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA.md
