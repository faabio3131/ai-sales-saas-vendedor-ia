# Integração Pix Mercado Pago — engenharia certificável

## Escopo entregue
- Adapter `MercadoPagoPixProvider`, aderente ao `PaymentProviderInterface`, via HTTPS `/v1/payments`.
- Pix copia e cola, QR Code base64, ticket URL e identificador da cobrança; idempotência de criação por tenant.
- Webhook público em `POST /api/payments/webhooks/mercadopago`, sujeito a assinatura HMAC válida, header x-request-id, query data.id e identidade correspondente do corpo.
- Notificação é apenas gatilho. O serviço consulta o pagamento novamente no PSP e reconcilia `amountMinor`, `tenantId:quoteId`, provider e ID.
- Bloqueio de regressão e de confirmações repetidas. Sem confirmação por prints ou texto do cliente.
- Sem habilitação bancária até configurar `MP_PIX_TENANT_ID`, `MP_PIX_ACCESS_TOKEN`, `MP_PIX_WEBHOOK_SECRET` e `MP_PIX_COLLECTOR_ID`.
- Credenciais somente server-side no secret store do deploy. O tenant configurado deve corresponder ao estabelecimento titular da conta Mercado Pago.
- Payer e-mail validado; fornecido junto da requisição de pagamento, sem valores inventados.
- Checkout e estornos não habilitados neste adapter; retornam erro seguro.

## Limitações importantes antes de produção
- Certificação de adapter por mocks não equivale a operação financeira real.
- Necessário testar com PSP em sandbox e conta real, webhooks, comprovante de beneficiário, vencimentos e estornos.
- Persistência de eventos e atualização de pagamento ainda não formam uma única transação atômica. Em escala, implementar transação/outbox e reconciliação por worker para tolerância a falhas.
- A autorização da criação de pagamento deve respeitar política de autonomia específica. O fluxo atual é de quote aceita, e não o Order Engine completo.
- Publicação na Contabo requer acesso operacional ao runtime; não presumir deploy.
