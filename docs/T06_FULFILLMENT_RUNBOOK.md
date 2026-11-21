# T06 — Runbook de cozinha, retirada e delivery

## Rotas

Prefixo protegido /api/fulfillment (sessão e membership por tenant obrigatórias).

- GET /units/:unitId/settings: consulta configuração versionada.
- PUT /units/:unitId/settings: OWNER/ADMIN publica operationMode, postalRanges, prepMinutes, deliveryMinutes, pickupMinutes e connectorId quando integrado, com expectedVersion CAS.
- GET /units/:unitId/queue: fila do estabelecimento e unidade, filtrada no backend.
- GET /units/:unitId/orders/:orderId: estado persistido do pedido.
- POST /units/:unitId/orders/:orderId/release: liberação idempotente quando Order CONFIRMED e pagamento verificado ou COD autorizado.
- POST /units/:unitId/orders/:orderId/transition: modo nativo, corpo com expectedVersion e action START, READY, DISPATCH_DELIVERY ou COMPLETE, de acordo com estados e papéis.
- POST /units/:unitId/orders/:orderId/escalate: OWNER/ADMIN, motivo e expectedVersion; somente revisão humana. Não duplica cozinha.

Não há endpoint público de ACK ou external-event. Eventos de PDV exigem adapter confiável.

## Preparação de cada unidade

1. Cadastrar BusinessProfile T02 e capacidades ORDERING, PRODUCTION e DELIVERY quando necessário, com um único modo.
2. Cadastrar catálogo T03 e zonas de entrega ativas com taxa BRL em centavos.
3. Configurar intervalos CEP de oito dígitos não sobrepostos, associando cada faixa à mesma zona ativa do catálogo. Validar zona real do estabelecimento; CEP é proxy, não geometria.
4. Administrador publica versão da política T06 e estimativas de preparo/retirada/entrega fornecidas pelo comerciante.
5. Se modo integrado, registrar e testar conector com readiness e ACK de idempotência. O runtime padrão bloqueia o modo integrado por não possuir conector real. Não contornar esse bloqueio.
6. Validar pagamento T04 com PSP_GET ou operador COD; Pix manual pendente não libera pedido.

## Jornada nativa

Pedido confirmado/pago -> release transacional -> QUEUED -> IN_PREPARATION -> READY. Para pickup: COMPLETE resulta PICKED_UP; para delivery: DISPATCH_DELIVERY -> COMPLETE. Atualizar estados via painel KDS somente com papel permitido. Não tratar saída de entrega como posição GPS real.

## Jornada integrada

Release grava AWAITING_ACK e evento/outbox. Worker despacha ao adapter com idempotencyKey estável. ACK correlacionado cria estado QUEUED; evento externo assinado progride pela sequência validada. Timeout do PDV pode significar sucesso remoto: repetir SOMENTE com idempotência garantida pelo parceiro, mantendo a mesma chave; se não houver confirmação, investigar antes de qualquer ação manual. Nunca fazer fallback para fila nativa sem confirmar inexistência do pedido no PDV. O comando escalate não autoriza despacho duplicado.

## Notificações

Somente eventos persistidos produzem outbox de notificação. Destinatário deve possuir identidade externa WHATSAPP_VERIFIED associada ao mesmo customer e telefone. Canal real não está instalado como padrão. Falha gera retry e DLQ; não marcar como mensagem entregue.

## Worker e implantação

Build gera dist/fulfillment-worker.cjs; npm run run:fulfillment-cycle executa uma rodada limitada. deploy/fulfillment-worker.compose.yaml especifica ciclo de cerca de 15 segundos, healthcheck e imagem de produção sem credenciais embutidas. Configurar workload identity, segredos de provedor, HMAC/mTLS e overlay de infraestrutura apenas durante implantação homologada. Aplicar índices versionados em deploy/t06-fulfillment.firestore-indexes.json na instância real. A CI não faz deploy, não provisiona índices nem valida assinatura real de terceiro.

Monitorar: pedidos AWAITING_ACK por muito tempo, DLQ, retries de notificações, pagamento REFUND_PENDING, mudança de operação, índices e saúde do worker. Manter procedimento de investigação e rollback auditado.

## Gates

T06 interna exige seis DoD e suíte cumulativa TypeScript/Python, build, segurança e Docker no mesmo SHA. O piloto T08 exige configuração real de negócio, PDV, WhatsApp e bancos, testes de integração com provedores externos, rede e Firestore. T07 fica travada até autorização humana após certificação T06.
