# T03 — CERTIFICAÇÃO INTERNA — UNIVERSAL ORDER ENGINE + FOOD SERVICE PACK

**Data:** 21/11/2026 • **Cronograma:** T03 do Cronograma Mestre com Trava v1.1
**Estado:** critérios de engenharia interna T03 aprovados na CI funcional da PR #13.
**Próxima fase:** T04 bloqueada até autorização humana explícita.

## Evidência funcional canônica
- PR #13: https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/13
- Commit funcional auditado (antes deste documento): 47bc7e8cd6ec28a9cef8536b0395ca3b430096b5
- CI integral: https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44922979257 — SUCCESS.
- Resultado: 248/248 testes TypeScript em 48 arquivos, 7/7 Python, build, typecheck, runtime security boundaries, gate de reconciliação e smoke Docker Node + Python aprovados.
- O smoke Docker de Node apresenta 247 PASS / 1 SKIP de teste que requer serviço externo; a CI principal executa a verificação HTTP Python real separadamente.
- A CI pós-merge deve ser conferida no SHA efetivo da main. Testes internos não equivalem a homologação externa.

## Entregas e provas
1. Catálogo por tenant+unit, versão, vigência, CAS e snapshot; itens universais e unidade alimentar configurável.
2. Pizza: tamanhos, sabores 1/2, bordas, adicionais e regras de preço meio a meio MAX_FLAVOR / AVERAGE_CEIL; sem preço inventado ou arredondamento acidental.
3. Bebidas (ITEM e variantes), combos fixos com componentes ativos, indisponibilidade, cupom fixo e percentual versionado, zonas e taxas de entrega configuradas.
4. Order Engine com dinheiro em centavos BRL e limite, DRAFT/CONFIRMED/CANCELLED; snapshot congelado das linhas e catálogo.
5. Idempotência persistente no escopo tenant/unidade/chave + fingerprint; transação Firestore cria pedido/índice/contador juntos.
6. Concurrency: teste determinístico de 50 pedidos simultâneos, numeração única monotônica por unidade; retries com chave idêntica não duplicam.
7. Alterações somente DRAFT com versão CAS; cancelamentos auditados; pedido confirmado não pode ser editado.
8. Confirmação explícita de cliente referenciada à conversa, ao cliente, orderId e total; sem comprovação, não sai de DRAFT.
9. Três dimensões independentes: paymentState NOT_REQUESTED, productionState NOT_DISPATCHED e deliveryState NOT_STARTED. Não houve chamada a gateway, PDV ou KDS.
10. Contrato dispatch-intent seguro para modos NATIVE_OPERATIONS e INTEGRATED_OPERATIONS, sempre dispatchEnabled=false.
11. BusinessGroundingService usa preços por unidade; preço de pizza sem escolha completa retorna UNKNOWN, não o preço do catálogo legado.
12. Endpoints de catálogo e pedido sob autenticação/membership do tenant; testes HTTP de autorização, isolamento e governança.

## Critérios de aceite da T03
- [x] Jornada de rascunho→aceite comercial reproduzível, cálculos determinísticos de produto, promoções e delivery.
- [x] Concorrência numérica, idempotência, atualização CAS, cancelamento e titularidade por tenant/unidade testados.
- [x] T03 não cria cobrança antes do aceite (nem após: competência exclusiva de T04).
- [x] Order Engine horizontal e desacoplado de PDV/cozinha/pagamentos; despacho não executável em ambos os modos.
- [x] Meio a meio, tamanhos, bordas, extras, bebidas, combos, promoções, disponibilidade, retirada/delivery, snapshot e taxa versionada testados.

## Restrições registradas, sem homologação indevida
- Nenhum cardápio, preço, endereço, telefone ou taxa real da Pizzaria Americana foi introduzido.
- Nenhum deploy, segredo real, conexão Firestore de produção, autenticação WhatsApp externa, entrega real, geração Pix ou cobrança bancária foi realizado.
- As transações Firestore foram implementadas e cobertas por modelos determinísticos de repositório; **não** houve teste de concorrência em Firestore externo ou emulator nesta CI. Homologação de infraestrutura/credenciais na implantação.
- Mensagem CUSTOMER/INBOUND persistida não substitui autenticação criptográfica do canal WhatsApp; T08 fará a prova operacional de origem.
- Catálogo legado continua atendendo QuoteService/PaymentService anteriores; vínculo Order→Payment, outbox, estorno e reconciliação são escopo T04. Não declarar jornada financeira fechada em T03.
- Checkout, KDS, delivery/geofence/entregador e painel operacional são T06/T07/T08, não estão ativados.
- Autorização existente é por tenant; RBAC de unidade distinto não foi adicionado como requisito de T03. Não prometer segregação de funcionários entre unidades sem essa camada.
- T04 permanece TRAVADA até aprovação humana após encerramento e CI pós-merge.

## ADR e manual
- docs/ADR-004_T03_UNIVERSAL_ORDER_ENGINE_FOOD_PACK.md
- docs/T03_ORDER_ENGINE_RUNBOOK.md
- docs/CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA.md
