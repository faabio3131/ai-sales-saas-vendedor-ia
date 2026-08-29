# BLK-140 — Quotes — PLAN

Status: PLANEJADO / AUTORIZADO PARA IMPLEMENTAÇÃO

## Objetivo único
Implementar `Quote`/`QuoteItem`, totalização determinística pelo domínio e fluxo inicial de envio/aceite, mantendo preços e totais como fonte de verdade comercial no servidor.

## Escopo autorizado
- entidades Quote e QuoteItem tenant-scoped;
- status `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CANCELLED`;
- criação de orçamento a partir de itens de catálogo reais do mesmo tenant;
- snapshot de descrição e preço no momento da criação;
- quantidade inteira positiva;
- totais em minor units (`subtotalMinor`, `discountMinor`, `totalMinor`);
- desconto explícito validado, nunca calculado por IA;
- vínculo opcional a Opportunity do mesmo customer/tenant;
- transição DRAFT -> SENT e SENT -> ACCEPTED;
- repositories tenant-scoped + Firestore adapter;
- API protegida por autenticação + TenantContext;
- testes de totalização, tenant isolation, validações e state machine.

## Fora de escopo
- pagamento/Pix/link (BLK-150);
- desconto automático por IA;
- PDF/assinatura sofisticada;
- envio real por WhatsApp como efeito obrigatório do quote service; a camada de canal permanece desacoplada.

## Gates
Architecture, Tenant, Security, Test, Documentation e Git são obrigatórios antes do fechamento.
