# DOCUMENTO MESTRE — AI SALES SAAS — VENDEDOR IA — v1.0

**Status:** cópia operacional canônica para execução técnica.  
**Fonte mestre:** Google Drive — `DOCUMENTO MESTRE — AI SALES SAAS — VENDEDOR IA — v1.0`.

## 1. Objetivo
Criar um SaaS comercial simples, rápido, escalável e orientado a pequenas e médias empresas. O produto deve reduzir perda de vendas e aumentar receita por atendimento com IA, organização automática de leads, follow-up, recuperação de vendas, recuperação de carrinho, upsell, cross-sell, proposta/orçamento e pagamentos.

## 2. Posicionamento
Mensagem central: **PARE DE PERDER VENDAS.**  
Não vender como “CRM técnico” ou “plataforma de IA”. O usuário deve perceber simplicidade; a complexidade fica escondida no backend.

## 3. Modos de operação
- Atendente IA;
- Assistente Comercial;
- Vendedor IA;
- Vendedor Autônomo IA.

A autonomia é configurável e separada do plano comercial.

## 4. Planos previstos
- **BASIC:** atendimento, FAQ, catálogo, captação de lead e transferência humana.
- **STANDARD:** Basic + CRM automático, classificação, pipeline, memória comercial e follow-up.
- **PRO:** Standard + vendedor IA, recuperação de vendas, propostas, upsell, cross-sell e analytics.
- **PREMIUM:** Pro + autonomia avançada, recuperação de carrinho, pagamentos/Pix, integrações e maior volume.

## 5. Plataforma
Primeira implementação: **Web App/PWA responsiva, Mobile First**, construída inicialmente no Google AI Studio. Deve funcionar em smartphone, tablet e desktop com uma base principal.

## 6. Repositório e portabilidade
Google AI Studio é ambiente de construção. GitHub é o repositório canônico durável. Nenhuma versão importante pode existir apenas no ambiente de IA.

## 7. Inteligência Artificial
A lógica comercial nunca chama um provedor diretamente.

`Business Domain → AI Service → Universal AI Provider Interface → AI Router → Provider Adapter`

Adapters previstos: Gemini, OpenAI, Anthropic e futuros provedores.

## 8. Pagamentos
`Business Domain → Payment Service → Payment Provider Interface → Adapter`

Provedores candidatos iniciais: Mercado Pago e PagBank. Confirmação de pagamento somente por backend/webhook validado.

## 9. Canais
Primeiro canal comercial: WhatsApp.

`Business Domain → Channel Service → Channel Interface → Adapter`

Futuros: Instagram, WebChat e outros.

## 10. Núcleo comercial
- Conversation Engine;
- Lead Intelligence Engine;
- Sales Engine;
- Follow-up Engine;
- Sales Recovery Engine;
- Cart Recovery Engine;
- Upsell/Cross-sell Engine;
- Quote/Proposal Engine;
- Payment Engine;
- Revenue Attribution.

## 11. CRM invisível
Conversas devem gerar clientes, leads, interesses, estágio e próxima ação automaticamente quando possível. Evitar CRM manual complexo.

## 12. Memória comercial
Resumo separado do histórico bruto: interesses, produtos, propostas, objeções, preferências, compras, contatos e follow-ups relevantes.

## 13. Multitenancy
O SaaS nasce multitenant. Toda entidade comercial é associada a `tenantId`/`tenant_id`. Dados de empresas diferentes nunca podem se misturar.

## 14. Segurança
Obrigatórios: autenticação, autorização, isolamento por tenant, secrets server-side, validação de webhook, validação de entrada, audit log, idempotência e sanitização de erros.

## 15. Autonomia
A IA opera dentro de políticas como `can_send_followup`, `can_create_quote`, `can_offer_upsell`, `can_create_payment`, `can_negotiate`, `max_discount`, `human_approval_above`.

A IA não pode inventar produtos, preços, descontos ou condições comerciais.

## 16. North Star
**RECEITA INFLUENCIADA OU RECUPERADA PELO SISTEMA.**

## 17. Escopo negativo
Não transformar em ERP, financeiro completo, RH, estoque avançado, compras, produção, BI empresarial amplo, KORDENA ou Super Core.

## 18. Gate de nova funcionalidade
Só entra se aumentar vendas/receita, reduzir perda, recuperar oportunidade, economizar trabalho comercial relevante ou melhorar conversão/retenção — e ainda for simples e escalável.

## 19. Método de construção
`PLAN → IMPLEMENT → TEST → REVIEW → FIX → VALIDATE → COMMIT → NEXT`

## 20. Regra final
**SIMPLES PARA O CLIENTE. SÓLIDO POR DENTRO. RÁPIDO PARA COLOCAR NO MERCADO. CONSTRUÍDO PARA ESCALAR.**
