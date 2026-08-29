# BLK-160 — Revenue Expansion — Plano

**Status:** AUTORIZADO PARA IMPLEMENTAÇÃO

## Objetivo
Implementar upsell, cross-sell e atribuição de resultado de expansão com dados reais do catálogo e confirmação financeira server-side.

## Escopo
- modelo tenant-scoped de oportunidade de expansão;
- tipos `UPSELL` e `CROSS_SELL`;
- sugestões baseadas exclusivamente em itens ativos e precificados do catálogo;
- Policy Engine antes de preparar ação comercial;
- aprovação humana quando exigida pela política/autonomia;
- atribuição de receita somente a pagamento `CONFIRMED` vinculado explicitamente à expansão;
- repositories abstratos + adapters Firestore;
- API protegida;
- testes de tenant isolation, catálogo, policy e atribuição.

## Regras de verdade comercial
- IA não inventa produto, preço, desconto nem receita;
- valor sugerido vem do catálogo persistido;
- receita atribuída vem de pagamento confirmado server-side;
- sugestão não é venda e não incrementa receita;
- atribuição é idempotente por expansão/pagamento.

## Fora de escopo
- campanhas automáticas;
- recomendador ML/IA sofisticado;
- descontos automáticos;
- criação automática de quote/payment;
- atribuição probabilística/multi-touch;
- dashboards avançados de LTV/cohort.

## Gates
Architecture, Tenant, Security, Test, Documentation e Git devem permanecer verdes.
