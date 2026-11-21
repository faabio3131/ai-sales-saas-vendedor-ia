# ADR-004 — T03: Universal Order Engine + Food Service Pack

**21/11/2026** | **Autoridade:** avanço autorizado da T02 para T03 | **Estado:** implementação candidata sujeita à CI integral.

## Decisão arquitetural
O AtendeVendeIA continua um núcleo comercial horizontal. O Food Service Pack é uma especialização do catálogo e dos preços; não duplica tenancy, IA, identidade, pagamentos ou workflow.

### Fontes de verdade
- BusinessProfile T02 determina tenant, unidade, capabilities, identidade e um único modo operacional (NATIVE_OPERATIONS ou INTEGRATED_OPERATIONS) por unidade.
- UnitCatalogRevision T03 é a autoridade de preço e disponibilidade para novos pedidos; armazena versões imutáveis em Firestore, indexadas pela chave SHA-256 de [tenant,unit], com publicação CAS. O catálogo legado catalogItems permanece para cotações antigas; não há migração implícita.
- Order T03 é a autoridade sobre um pedido comercial. PaymentState permanece NOT_REQUESTED; ProductionState NOT_DISPATCHED; DeliveryState NOT_STARTED, inclusive após pedido CONFIRMED.
- DispatchIntent informa o modo operacional e sempre tem dispatchEnabled=false nesta tarefa. T06 será responsável por despacho real, fila/ACK/outbox e integração PDV/KDS.

## Regras de preço determinísticas
- ITEM: preço fixo ou variante explícita, adicionais ativos selecionados, incluindo bebidas e serviços.
- PIZZA: tamanhos, sabores (1 ou 2), bordas e adicionais; preços por tamanho; meio a meio usa MAX_FLAVOR ou AVERAGE_CEIL, conforme a política cadastrada por unidade.
- COMBO: preço fixo configurado, componentes válidos do catálogo e ativos, sem componentes recursivos.
- Promoções: código explícito, vigência e elegibilidade por SKU, mínimo, desconto fixo ou percentual em basis points e teto no subtotal elegível.
- Fulfillment PICKUP sem taxa. DELIVERY exige capability DELIVERY, zona ativa com taxa cadastrada e endereço. A validação geográfica real fica em T06.
- Centavos BRL como inteiros seguros: sem floats de dinheiro, limite e proteção de overflow por item, linha, promoção, subtotal e total.
- Preços inexistentes, variantes inativas, sabores incompatíveis, promoções expiradas e itens sem disponibilidade geram erro governado, não estimativa da IA.

## Integridade, idempotência e governança
- Nova requisição cria apenas DRAFT, para cliente que pertence ao tenant.
- Chave idempotente por tenant/unidade vinculada a hash do pedido. Reenvio idêntico devolve o mesmo Order; mesma chave e conteúdo diferente gera CONFLICT.
- Número por tenant/unidade incrementado em transação Firestore; pedido, índice idempotente e contador são gravados juntos.
- Mudanças em DRAFT exigem expectedVersion, reprecificam usando versão atual do catálogo e preservam orderNumber/cliente/unit; alteração depois da confirmação é proibida.
- Confirmação só aceita prova de mensagem inbound CUSTOMER persistida no escopo correto e vinculada ao orderId + total em centavos. Recalculo é necessário após atualização de catálogo ou alteração do modo operacional. T03 jamais chama gateway de cobrança.
- Cancelamento DRAFT/CONFIRMED exige motivo, autor e versão, não gera estorno (T04) nem despacho (T06). CANCELLED é terminal.
- Autorização via Firebase Auth + membership por tenant e papel autorizado. Não há membership por unidade no token atual; limitação herdada do T02. Quem tem acesso operacional ao tenant poderá consultar suas unidades até existir autorização por unidade.
- **Limitação de origem de mensagens:** a verificação de mensagem persistida não prova, isoladamente, a identidade do remetente no WhatsApp. A validação criptográfica do canal e do fornecedor permanece gate externo T08; nenhuma cobrança é gerada com essa evidência.

## Integração do conhecimento T02
BusinessGroundingService consulta, por padrão, o UnitCatalogRevision da unidade ao responder preços. Não herda valores do catálogo legado de outras unidades. Preços fixos e sem variantes podem ser respondidos; preços de pizza e itens com variantes sem seleção completa retornam UNKNOWN em vez de valores inventados. O mesmo catálogo fornece evidência permitida ao ContextPack T01.

## Etapas explicitamente posteriores
- T04: vínculo Order→Payment, outbox, status de pagamento, Pix, estorno e conciliação.
- T05: ledger financeiro e painéis reconciliáveis.
- T06: produção, despacho, delivery geográfico, modos nativo/integrado e ACK.
- T08: dados reais da Pizzaria Americana, credenciais, homologação de canal WhatsApp, integração a sistemas e execução operacional na infraestrutura.

## Certificação obrigatória
Preços exatos, meio a meio, variantes, bordas, adicionais, combos, bebida, promoção, disponibilidade, taxa, retirada, snapshot, idempotência, 50 pedidos concorrentes, CAS, titularidade, cancelamento, aprovação vinculada ao ID/valor, multitenant, multiunidade, auth/RBAC, e gates cumulativos build/TypeScript/Python/segurança/Docker.
