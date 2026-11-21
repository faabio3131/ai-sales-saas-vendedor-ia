# ADR-006 — T05: Finance Ledger, deterministic financial queries and tenant authority

**Data:** 21/11/2026. **Proposta executada:** T05 após T04 certificada. **T06 permanece bloqueada.**

## Autoridade e origem dos dados
O painel financeiro pertence ao estabelecimento; custos, receita da plataforma e uso de modelos de IA da FM Tecnologia não são lançados como despesas do restaurante. Nenhuma resposta de LLM define, corrige ou autoriza valores. As fontes da T05 são:
1. pedidos T03 confirmados com snapshot imutável de itens, descontos e entrega;
2. outbox transacional de pagamentos T04, persistida atomicamente junto aos estados de pagamento, inclusive eventos ainda não publicados;
3. perfil efetivo da unidade T02 para timezone IANA e preferências de início da semana.

O feed comercial-financeiro derivado do outbox pode atrasar ou entrar em DLQ. **A consulta não usa eventos entregues como única fonte:** reconstrói com o outbox canônico, valida versões consecutivas, origem das confirmações, valor exato e vínculo com o pedido. Qualquer inconsistência ou falta de histórico provoca falha fechada. Backfill de históricos antigos sem T03/T04 exige migração e reconciliação independente; não são somados sem fonte equivalente.

## Definições monetárias oficiais (R$ em centavos, sem floats)
- **Vendas brutas:** soma de subtotal do pedido mais frete de delivery dos pedidos atualmente confirmados, aceitos no período, *antes* dos descontos.
- **Descontos:** descontos registrados no snapshot dos mesmos pedidos.
- **Vendas líquidas (após desconto):** total de pedidos confirmados no período, igual a vendas brutas menos descontos. **Não** significa recebimento bancário, receita tributável, lucro ou vendas após estorno.
- **Pedidos:** número de pedidos confirmados no período. Cancelamentos T03 são excluídos dos snapshots correntes; relatórios históricos podem ser recalculados quando um pedido antes do pagamento é cancelado.
- **Ticket médio:** vendas líquidas dos pedidos / contagem de pedidos, arredondado ao centavo; zero apenas se nenhum pedido.
- **Recebimentos confirmados:** soma dos eventos PAYMENT_CONFIRMED que têm prova PSP_GET ou atestação presencial OPERATOR_COD válida, pela data do evento e não pela data original da venda.
- **Estornos:** soma dos eventos PAYMENT_REFUNDED com prova PSP_GET, datados da efetiva confirmação do reembolso.
- **Recebimentos líquidos após estornos:** recebimentos confirmados menos estornos do próprio intervalo, podendo ser negativos em um período de estorno de vendas antigas.
- **Pendentes a receber:** valor de pedidos comercialmente confirmados no intervalo sem evento de pagamento confirmado até o fim exclusivo do intervalo ou até a posição asOf. PIX_MANUAL e cobranças expiradas permanecem não quitadas.
- **Ranking:** quantidade de unidades de itens faturados no snapshot dos pedidos confirmados; desempate por venda bruta do item e ID. Cupom/desconto global não é arbitrariamente alocado a itens.
- **Taxas de gateway, processamento, liquidação, câmbio:** **null / NOT_REPORTED_BY_VERIFIED_PSP_FEED**, não zero. O payload PSP da T04 não fornece comprovante contábil de todas essas tarifas. Recebimentos após taxas permanecem **null** até um feed certificado com vínculo ao PSP. Não projetar margem ou lucro a partir de suposições.

## Tempo e projeções
- Datas comerciais são calculadas no timezone IANA do perfil T02 do estabelecimento, nunca pelo timezone do navegador.
- Day, week e month usam intervalos semiabertos [start, end), com início da semana configurável (0=domingo, 1=segunda como padrão).
- Conversão de meia-noite local em instantes UTC trata transições de horário de verão (dias de 23 e 25 horas). Anchor aceita somente datas ISO reais.
- Recibos e estornos são reportados pelo relógio de ocorrência do evento, independentemente da data da venda.
- Consultas anteriores ao asOf não incluem eventos futuros; relatório de período em andamento é parcial até now. Reconstituição integral é feita sob demanda com as fontes canônicas, não com estimativas de LLM.
- Cada relatório traz source, coverage, reconciled counts e feeCoverage. O escopo de cobertura atual é T03/T04, sem somar automaticamente cotações legadas.

## Segurança e interface
- API financeira sob /api/finance: sessão + membership ativa + RBAC OWNER ou ADMIN. O canal público de atendimento e os papéis de atendimento/caixa não têm acesso.
- Unidade é validada server-side e todas as leituras são filtradas por tenant e unidade. O painel React não é renderizado para papéis sem privilégio e a resposta não é armazenada no browser.
- Perguntas administrativas em português são convertidas em intenções enumeradas. A classificação AI, quando disponível, recebe **somente a pergunta**, nunca extratos nem valores; resposta do modelo é rigidamente validada como uma chave permitida. A resposta em reais vem do ledger determinístico e contém ressalvas, inclusive taxas indisponíveis.
- Solicitações de lucro, impostos, despesas e dados de outra empresa são negadas, não substituídas por uma estimativa.
- Configuração de dia inicial da semana tem versionamento CAS, autoria e timestamp; nenhuma mutation financeira é exposta pelo painel.

## Escalabilidade e qualidade
O repositório de leitura usa paginação de 500 registros por consulta e índices tenant/unidade; rejeita conjuntos acima do limite seguro (100.000 pedidos ou eventos) em vez de emitir números parciais. O manifesto deploy/t05-finance.firestore-indexes.json é versionado; a aplicação real dos índices e otimização por projeções incrementais deverão ser verificadas em operação. CI com repositórios simulados não constitui benchmark Firestore real.

## Dependências externas
Sem deploy Contabo/Cloud Run, dados reais do estabelecimento, configuração de PSP, prova de webhook real, parametrização de tarifas e homologação de feed bancário. Essas dependências devem ser verificadas antes do piloto T08; não são convertidas em DONE fictício.
