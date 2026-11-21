# T03 — Runbook técnico do Catalog + Order Engine

## APIs autenticadas
Todas as rotas são montadas com authenticationMiddleware e tenantAuthorizationMiddleware. Usuários externos não recebem autorização apenas por fornecer X-Tenant-ID.

### Catálogo
- GET /api/commerce/units/:unitId/catalog — revisão vigente ou null.
- GET /api/commerce/units/:unitId/catalog/latest — revisão mais recente, inclusive agendada (OWNER/ADMIN).
- POST /api/commerce/units/:unitId/catalog/revisions — publicar nova revisão imutável (OWNER/ADMIN), com expectedVersion para evitar perda de atualização.

### Pedidos
- GET /api/orders/units/:unitId — pedidos no escopo tenant+unit.
- POST /api/orders/units/:unitId — criar DRAFT com idempotencyKey e expectedCatalogVersion.
- GET /api/orders/units/:unitId/:orderId — snapshot do pedido.
- PATCH /api/orders/units/:unitId/:orderId — editar apenas DRAFT, expectedVersion CAS e reprecificação.
- POST /api/orders/units/:unitId/:orderId/confirm — confirmar após evidência de aceite pelo customer.
- POST /api/orders/units/:unitId/:orderId/cancel — cancelamento com motivo e ator.
- GET /api/orders/units/:unitId/:orderId/dispatch-intent — envelope NÃO executável de produção.

## Pedido de exemplo (inteiramente fictício)
~~~json
{
  "customerId": "cust-a",
  "idempotencyKey": "order_request_001",
  "expectedCatalogVersion": 1,
  "lines": [
    {"catalogItemId": "pizza", "quantity": 1, "sizeId": "g",
     "flavorIds": ["marg", "calab"], "borderId": "cat",
     "addonIds": ["bacon"]},
    {"catalogItemId": "drink", "quantity": 2, "variantId": "l"}
  ],
  "fulfillment": {"kind": "PICKUP"}
}
~~~
Os identificadores e preços são apenas de teste, **não são o cardápio da Pizzaria Americana**.

### Confirmação comercial
- Criar o rascunho e expor ao cliente seu ID, itens e total exato.
- A referência informada na confirmação deve apontar a mensagem inbound CUSTOMER com a frase exata: CONFIRMO PEDIDO [orderId] TOTAL [totalMinor] CENTAVOS.
- O total tem que coincidir com o rascunho; a versão do catálogo ainda precisa ser vigente. Sem confirmação: DRAFT e paymentState NOT_REQUESTED.
- Mensagem de IA, funcionário, outro cliente ou outro pedido não libera confirmação. Em T08, comprovar identidade real e assinatura do canal WhatsApp.
- CONFIRMED não significa pagamento confirmado. Nenhum PSP, estorno ou PDV é chamado em T03.

## Segurança e integridade
- Preços somente da versão ativa do catálogo tenant+unit, nunca de valores da requisição ou do modelo.
- Promoções e delivery dependem de regras versionadas; zonas de entrega NÃO são verificação GPS/geofence.
- Operação em ambos os modos é somente planejamento: dispatchEnabled=false, status NOT_DISPATCHED.
- Reenvie a mesma idempotencyKey apenas com o mesmo payload; mude a chave para um pedido diferente.
- Mutação concorrente usa expectedVersion; não force versões nem desative os testes.
- O catálogo legado ainda alimenta o QuoteService anterior. A migração/reconciliação ao novo Order Engine é a tarefa T04. Evitar dupla cobrança no futuro.

## Gate de implantação
A CI de engenharia usa doubles determinísticos de repositório, não credenciais reais da Pizzaria Americana ou Firestore em produção. Antes do piloto T08 devem existir dados verdadeiros, verificação do WhatsApp, mecanismos de segurança por unidade quando exigidos, conectividade operacional e validação da taxa de entrega. Sem homologação externa, não marcar produção pronta.

## CI e fechamento
Aprovar suíte completa em HEAD, incluindo Python, integração cognitiva, testes Food Pack, runtime security boundaries, Docker Node e Python; publicar PR, SHA, CI e atualizar Cronograma Mestre. T04 só avança após nova autorização humana.
