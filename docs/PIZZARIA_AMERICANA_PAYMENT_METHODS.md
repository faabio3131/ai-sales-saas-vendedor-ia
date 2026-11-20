# Pagamentos manuais por estabelecimento — Pizzaria Americana (preparação)
Data: 2026-11-20. Implementação de engenharia sujeita à certificação; não equivale a go-live.

## Comportamento
- Configuração independente por tenant no Firestore, por padrão todos os meios desabilitados.
- GET /api/payments/methods: consulta autenticada do estabelecimento.
- PUT /api/payments/methods: somente OWNER autenticado e membro do tenant; payload completo `pixManualEnabled`, `cardOnDeliveryEnabled`, `cashOnDeliveryEnabled`, `pixKey` opcional.
- POST /api/payments: após quote aceita, aceita `PIX_MANUAL`, `CARD_ON_DELIVERY`, `CASH_ON_DELIVERY` se habilitados pelo proprietário.
- Pagamento offline permanece PENDING, sem providerPaymentId e sem falso recebimento; `refresh` não altera seu status.
- `PIX` dinâmico e `PAYMENT_LINK` existentes continuam dependentes de um PSP real. O provider estrutural falha fechado.
- Nenhuma chave Pix da pizzaria foi configurada e nenhuma forma de pagamento foi ativada.
- Não divulgar opções não confirmadas pela proprietária. O serviço de atendimento deve consumir a configuração ativa antes de oferecer meio de pagamento.
- Não gerar QR code falso; Pix manual com chave não é confirmação do pagamento.
- Não realizar confirmação manual sem um fluxo autenticado e auditado de conciliação; exige etapa posterior.
- A rota de webhook existente não deve ser exposta diretamente sem um endpoint autenticamente vinculado ao PSP e ao tenant.

## Limites e próximos gates
Implantar adapters reais de PSP, confirmar beneficiário, valores e webhook, reconciliar em transação e validar falhas sob concorrência antes de pagamentos automáticos. O fluxo atual de quote ainda não constitui Order Engine completo.
