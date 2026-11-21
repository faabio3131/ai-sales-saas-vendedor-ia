# T04 — Operação técnica do Payment Engine

## API autenticada
Prefixo: /api/order-payments (sessão e membership de tenant obrigatórias).
- GET /units/:unitId/orders/:orderId — obter o pagamento existente.
- POST /units/:unitId/orders/:orderId — criar pagamento somente para Order.CONFIRMED; corpo: idempotencyKey, method e opcional providerId, payerEmail ou cashTenderedMinor.
- POST /units/:unitId/payments/:id/refresh — GET oficial do provedor e reconciliação.
- POST /units/:unitId/orders/:orderId/recover — OWNER/ADMIN; corpo: expectedVersion e providerPaymentId verificados independentemente.
- POST /units/:unitId/orders/:orderId/collect — cobrança em espécie/POS na entrega, com papel autorizado, expectedVersion, amountMinor e receiptRef.
- POST /units/:unitId/orders/:orderId/refund — OWNER/ADMIN; expectedVersion e reason, sem supor estorno liquidado.

## Autoridade de liquidação
Pagamento via Pix só vira CONFIRMED após validação da conta, valor, moeda e referência por GET do PSP. QR code, cópia e cola, print e texto de IA não são prova. Para cash/card on delivery, apenas a atestação operacional autenticada pode registrar recebimento, com fonte explicitamente OPERATOR_COD.

## Adapters e métodos
As contas dos clientes permanecem na borda, com merchantPaymentConnections, MerchantPaymentVault, recipient verificado e PaymentProviderResolver. Os adapters bancários Pix existentes foram preservados. Checkout de cartão depende de adapter com supportedMethods declarado; os adapters atuais Pix-only não foram indevidamente promovidos a adquirentes de cartão. Sem PAN/CVV no sistema.

## Endpoints de webhook já existentes
- /api/payments/webhooks/:provider/:tenantId: Asaas, Pagar.me, Efí, Inter, BB — autenticação específica e GET PSP; roteamento automático para pagamentos legados ou de pedidos.
- /api/payments/webhooks/mercadopago: HMAC para conta MP configurada e consulta PSP; atende pagamento legado ou pedido.
- PagBank: webhook bloqueado até validação de assinatura; conciliação GET funciona sem webhook.
- Efí/Inter/BB exigem edge mTLS independente e relay HMAC com relógio e segredo do merchant.

## Contabo, reconciliação e FinOps
npm run build deve produzir dist/payment-reconciler.cjs e dist/order-payment-workers.cjs.
npm run reconcile:order-payments faz uma rodada limitada de pagamentos novos + eventos financeiros.
O Compose deploy/payment-reconciler.compose.yaml agora roda os dois workers em sequência a cada ~5 minutos, preservando o arquivo de saúde apenas se ambos concluírem corretamente. O overlay de cofre montado permanece opcional e precisa coincidir com o backend HTTP.

Coleções novas:
- orderPayments; orderPaymentByOrder; orderPaymentByIdempotency; orderPaymentProviderIds.
- orderPaymentOutbox; commercialFinancialEvents.
- orderPaymentReconciliationLeases; orderPaymentReconciliationCursors; orderPaymentReconciliationDlq; orderPaymentInvestigationCases.

Alertar DLQ, falhas, atraso de eventos, timeout e casos de criação incerta. Nenhum worker foi declarado ativo na Contabo por esta documentação.

## Procedimento de recuperação
1. Não repetir createPix no caso de timeout ou PSP ID desconhecido.
2. Consultar provedor com credencial e tenant/recipient corretos.
3. Confirmar o valor exato, referência tenant:order e PSP ID. Usar /recover com OWNER/ADMIN.
4. Aguardar GET verificado ou conciliador periódico; não alterar status por print.
5. Estorno não confirmado permanece REFUND_PENDING; nunca reenviar automaticamente a instrução bancária.

## Pré-go-live
Exigir dados reais do cardápio e estabelecimento, autorização do merchant, credenciais do cofre, testes de Pix real controlados, HMAC/mTLS, reconciliação com Firestore real, expiração, reembolso, custódia correta, alertas, verificação real de identidade no canal WhatsApp, rollback e teste da imagem Docker na infraestrutura. O T04 certifica engenharia; T08 é a homologação de ambiente/piloto.
