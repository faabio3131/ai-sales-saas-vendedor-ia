# T05 — Manual de engenharia e operação da Gestão Financeira Comercial

## Rotas
Todas exigem sessão e membership ativa para o x-tenant-id. Somente OWNER e ADMIN têm permissão. Nunca disponibilizar no webhook ou no chat público.

- GET /api/finance/units/:unitId/snapshot?period=day|week|month&anchor=YYYY-MM-DD
- GET /api/finance/units/:unitId/settings
- PUT /api/finance/units/:unitId/settings — expectedVersion e weekStartsOn (0–6), CAS com auditoria de autor.
- POST /api/finance/units/:unitId/ask — question e period opcional. A resposta é sempre calculada pelo ledger, jamais um texto numérico gerado pelo modelo.

A leitura requer BusinessProfile T02 efetivo com timezone válido. Unidade padrão mostrada pela interface: main; outras unidades selecionadas explicitamente pelos titulares autorizados. Não há descoberta automática de unidades em T05.

## Fórmulas
| Indicador | Fonte | Cálculo |
|---|---|---|
| Vendas brutas | Order T03 confirmado | subtotalMinor + deliveryFeeMinor |
| Descontos | Order T03 confirmado | discountMinor |
| Vendas líquidas | Order T03 confirmado | totalMinor, antes de estornos |
| Quantidade de pedidos | Order T03 confirmado | count |
| Ticket médio | Orders confirmados | round(sum(totalMinor)/count) |
| Recebimentos | Outbox T04 | PAYMENT_CONFIRMED com PSP_GET ou OPERATOR_COD válido |
| Estornos | Outbox T04 | PAYMENT_REFUNDED com PSP_GET |
| Recebimentos líquidos | Outbox T04 | received - refunded (pode ficar negativo) |
| Pendentes | Order + Outbox | pedidos aceitos no intervalo sem evento confirmado asOf |
| Ranking | snapshots de linha T03 | sum(quantity) e grossItemSalesMinor |
| Taxas PSP | feed PSP externo não conectado | null, nunca assumir zero |

## Reconciliação e falhas
- Confirmar que o T04 registra outbox atomically com mudanças financeiras, que a unidade e tenant são consistentes e que não existem lacunas de versão.
- A agregação verifica exatamente as evidências de PSP_GET vs OPERATOR_COD, o valor total do pedido, a unicidade payment/order e timestamps ordenados.
- Os números do painel **não** dependem do worker de entrega do outbox estar em dia, mas o monitoramento da DLQ continua obrigatório.
- Limite atual da consulta direta: 5.000 pedidos e 5.000 eventos por unidade. Acima disso a API retorna erro de integridade; executar um projeto de agregação/materialização escalável antes de atender unidades maiores. Não retornar valores truncados.
- Se taxas de gateway não estão comprovadas, marcar feeCoverage NOT_REPORTED_BY_VERIFIED_PSP_FEED, não apresentar margem, lucro ou receita líquida fiscal.
- Pagar.me/Inter/BB/PagBank e outros providers continuam sujeitos à homologação da T04/T08; a T05 não habilita cobranças.

## Certificação antes de implantação
1. Build, typecheck, testes internos e smoke Docker verdes no mesmo SHA.
2. Testar relatórios por dia, semana e mês em timezone do restaurante, DST, fronteira de mês e dia.
3. Reconstrução de histórico de vendas e estornos; reconciliação 100% dos eventos conhecidos.
4. HTTP 403 para não administradores, sem chamar IA nem consultar bancos.
5. Verificar índices Firestore em deploy/t05-finance.firestore-indexes.json no projeto real.
6. Confirmar que o painel React aparece apenas para OWNER/ADMIN e que mudança de tenant invalida visualização anterior.
7. Realizar verificação ponta a ponta da base real somente quando aprovada a infraestrutura e houver credenciais; não declarar esta verificação como executada pela CI.

**Trava:** T06 somente com aprovação explícita após certificação T05.
