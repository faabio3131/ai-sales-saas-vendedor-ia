# ADR-007 — T06: Produção, delivery e dois modos operacionais

Data: 21/11/2026. Escopo: engenharia interna autorizada após a T05. T07 permanece travada.

## Decisão

Há um único destino operacional de produção por pedido e unidade. O modo NATIVE_OPERATIONS utiliza fila KDS própria e registro autenticado dos estados. O modo INTEGRATED_OPERATIONS envia somente a um adaptador PDV/KDS certificado por contrato, sem criar um segundo pedido em cozinha local caso falte ACK. O modo do pedido é imutável desde T03; perfil empresarial e configuração de fulfillment devem coincidir.

## Autoridades canônicas

- Orders T03 contém confirmação comercial, itens e preços imutáveis; o estado de produção/entrega passa a ser projeção de transações operacionais T06.
- OrderPayments T04 contém liquidação PSP_GET ou atestação presencial OPERATOR_COD. Liberação exige pedido confirmado e pagamento confirmado com prova adequada, ou modalidade expressamente habilitada de CASH_ON_DELIVERY ou CARD_ON_DELIVERY. PIX_MANUAL pendente não libera produção.
- BusinessProfile T02 mantém capabilities PRODUCTION e DELIVERY e modo por unidade; transação bloqueia troca de modo enquanto houver pedido confirmado não concluído.
- UnitFulfillmentSettings T06 é versão CAS de ranges CEP sem sobreposição, tempo de preparo, retirada, delivery e connectorId somente integrado. Operações em aberto são contadas transacionalmente.
- ProductionOperations mantém única entidade por tenant/unidade/order, estado, snapshot, correlação, externalOrderId e versão CAS. ProductionEvents + ProductionOutbox + ProductionInbox compõem trilha durável, retries, claim/lease/fencing, backoff e DLQ.

## Delivery Engine

CEP de oito dígitos deve ocorrer exatamente uma vez no endereço informado, pertencer a uma única faixa postal cadastrada para a zona da unidade e coincidir com zona ativa do catálogo. Criação, edição e confirmação de delivery passam pela mesma validação ANTES de iniciar pagamentos. A liberação revalida a área sem modificar silenciosamente a taxa imutável do pedido. Retirada usa taxa zero e dispensa endereço/CEP. ETA representa apenas política de tempo configurada pelo comerciante, prepMinutes + deliveryMinutes ou pickupMinutes; não é previsão de trânsito, validação geográfica, GPS ou geocodificação. Status de entrega autenticado não significa geolocalização verificada.

## Modo nativo

Transação de release exige Order CONFIRMED, comprovante T04 adequado ou COD habilitado, mesma unidade/tenant, perfil/mode, política e versão. Faz criação única de ProductionOperation, atualização do Order, evento e outbox na mesma transação. Fases: QUEUED, IN_PREPARATION, READY, OUT_FOR_DELIVERY e COMPLETED para delivery; QUEUED, IN_PREPARATION, READY e COMPLETED/PICKED_UP para retirada. Cada evolução é auditada e versionada e o painel operacional só mostra valores persistidos. RBAC diferenciado por release, cozinha, entrega e administrador.

## Modo integrado

ProductionDispatchPort schemaVersion 1 obriga readiness, dispatch com correlação/idempotencyKey estável e ACK verificável. O estado AWAITING_ACK não vira QUEUED sem ACK válido com tenant, unidade, pedido, idempotencyKey, connectorId, externalOrderId e proofRef. O provedor precisa oferecer idempotência também sob timeout e retry. Eventos de status externo somente entram por adapter.verifyStatus, cuja responsabilidade é verificar assinatura/autenticidade e produzir evento confiável; não há endpoint aberto que aceite status JSON arbitrário. Inbox deduplica eventos e estados nunca podem avançar fora da sequência. Um ACK perdido não pode duplicar pedido na cozinha.

Sem conector homologado instalado, EmptyProductionAdapterRegistry bloqueia INTEGRATED_OPERATIONS; selecionar o nome do modo por configuração não habilita integração. Em falha repetida, outbox vai para DLQ e um OWNER/ADMIN pode solicitar MANUAL_REVIEW_REQUIRED com manualDispatchAuthorized=false. Essa revisão jamais ativa automaticamente cozinha nativa alternativa.

## Notificações

Eventos READY, DeliveryDispatched, DeliveryCompleted e OrderPickupCompleted só produzem notificação depois da transação persistida. ChannelCustomerNoticePort exige customer no mesmo tenant, telefone igual ao registro separado trustedCustomerChannelIdentities com assinatura/proveniência SIGNED_PROVIDER_WEBHOOK, e idempotencyKey do evento. O cadastro comum de externalIdentities é editável e NUNCA comprova WhatsApp; não há endpoint público para gravar prova assinada. Sem prova segura e adaptador de canal real, a mensagem não é emitida. O canal padrão continua sem credenciais reais nem adapter WhatsApp ativo; o envio permanece pendente/falha segura, não é contabilizado como entregue. O retorno positivo do provedor indica aceitação do envio, não leitura ou entrega definitiva pelo cliente.

## Limites e certificação

Os testes da T06 cobrem contrato do adapter fake, produção nativa, CEP, pickup/delivery, conciliação de pagamento, concorrência, CAS, inbox/outbox, papéis e modo único. Os testes com doubles determinísticos não certificam concorrência Firestore real. Infraestrutura Contabo, assinatura de PDV terceiro, KDS externo, canal WhatsApp real, GPS e credenciais são gates de implantação/piloto T08. É proibido declarar homologação externa, deploy ou notificação real sem evidência. T07 exige autorização humana específica depois da T06 certificada.
