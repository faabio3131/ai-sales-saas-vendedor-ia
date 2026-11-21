# ADR-005 — T04: Governed Order Payment Engine, PSP Fabric & Financial Outbox

**Data:** 21/11/2026. **Escopo autorizado:** T04 após T03. **T05 permanece bloqueada.**

## Decisões canônicas
O Order Engine T03 define confirmação comercial, mas não quitação. O OrderPayment T04 mantém estados financeiros próprios. Toda transição altera pagamento, projeção financeira do pedido e grava evento no outbox na mesma transação Firestore. Produção e entrega nunca mudam por eventos de pagamento.

A camada T04 reutiliza os adaptadores já existentes Mercado Pago, Efí, Asaas, Pagar.me, Banco Inter, Banco do Brasil e PagBank, com contas individuais de cada tenant, cofre de credenciais e verificação de recipient. Santander e Itaú continuam aguardando contratos; Stone, Sicoob e Sicredi permanecem planejados. Nenhum PSP é declarado homologado externamente nesta T04.

### Gate financeiro
- A autorização de pagamento verifica usuário autenticado e role permitido, tenant+unit, Order persistido CONFIRMED, identidade do cliente e total em BRL. A política geral de IA passa a negar CREATE_PAYMENT sem o contexto de pedido confirmado.
- A reserva transacional cria índice por pedido, chave idempotente, estado financeiro, referência do pedido e evento de outbox; só então chama o PSP. Repetição concorrente nunca chama createPix outra vez. Mesmo pedido não pode gerar uma segunda tentativa automática enquanto uma liquidação tardia puder existir.
- Resposta ausente do PSP gera RECONCILIATION_REQUIRED e investigação humana; a criação não é repetida cegamente. Recuperação governada por OWNER/ADMIN exige GET oficial do PSP com valor, referência e merchant verificados.
- A referência única do PSP é indexada transacionalmente; não pode ser vinculada a pedidos distintos da mesma empresa.

### Métodos
- Pix dinâmico: payload copia-e-cola, QR base64 e expiração somente quando retornados/comprovados no adapter. A ausência de dados não é preenchida ficticiamente.
- CHECKOUT/PAYMENT_LINK: contrato seguro, somente HTTPS e capability explicitamente anunciada pelo adapter; atuais adapters Pix-only não anunciam checkout de cartão operacional. Nunca processar PAN/CVV no SaaS.
- PIX_MANUAL fica PENDING até comprovação bancária independente, jamais print ou afirmação de LLM.
- CARD_ON_DELIVERY/CASH_ON_DELIVERY: após pagamento presencial, confirmação exige papel OWNER/ADMIN/MANAGER/CASHIER, valor integral, recibo operacional sem PAN, ator e horário; evento sinaliza OPERATOR_COD, distinto de PSP_GET. Troco em centavos é cálculo informativo.

### Webhooks e reconciliação
- Para Asaas e Pagar.me usam-se tokens/HMAC preexistentes; para Efí/Inter/BB usa-se relay mTLS+HMAC autenticado por borda. Mercado Pago mantém endpoint HMAC de tenant configurado. PagBank webhook permanece bloqueado até verificação contratual de autenticação, com polling GET.
- Evento recebido é somente um gatilho de consulta oficial. Status do corpo do webhook ou do texto do cliente nunca confirma uma cobrança. Valor, referência e ID de conta beneficiária são verificados via adapter vinculado ao tenant.
- Worker T04 percorre pendências, expirações, pagamentos tardios e estornos. Usa leases, backoff, DLQ, alerta de estornos que permanecem pendentes por mais de 24 horas e casos de investigação de PSP sem referência.
- Eventos imutáveis do outbox são entregues por worker com fencing e retries ao repositório commercialFinancialEvents, que constitui uma fonte auditável para futura T05. Eventos de cobrança confirmada têm collectedMinor; eventos de refund verificado têm refundedMinor. Não equivalem a lucro ou receita fiscal.

### Estornos e cancelamento
Somente OWNER/ADMIN pode solicitar estorno, com motivo e versão. A intenção REFUND_PENDING é persistida antes da chamada remota. Falha/timeout do PSP não é reenviada automaticamente. REFUNDED só após confirmação verificada por GET. O cancelamento T03 de pedido com pagamento iniciado é bloqueado até resolução financeira governada.

### Infraestrutura
O Compose do worker de reconciliação existente foi estendido para executar em ciclo o worker legado e a T04/outbox. Só atualiza o health marker se ambos têm êxito, intervalo de 5 minutos após cada rodada. Esta configuração é código implantável; **não é prova de deploy real na Contabo**.

### Compatibilidade e ressalvas
Cotações legadas continuam com seus pagamentos existentes; nenhuma migração, alteração de preços ou duplicação automática de cobranças. A coleção OrderPayment é própria, sem reutilizar Quote como origem de pedido. Não houve autenticação real de WhatsApp, banco externo, terminal POS, PSP de produção, emissão fiscal nem deploy nesta etapa. A prova de engenharia usa testes determinísticos e contratos de PSP; a homologação externa pertence aos gates de implantação da T08.
