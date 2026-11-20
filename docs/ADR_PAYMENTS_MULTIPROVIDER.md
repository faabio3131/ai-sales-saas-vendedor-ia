# ADR — Payment Fabric Multi-PSP / Multibanco
Data: 2026-11-20
Estado: ARQUITETURA APROVADA COMO DIRETRIZ DE PRODUTO; IMPLEMENTAÇÃO PARCIAL.

## Princípio
AtendeVendeIA é independente de Mercado Pago e de qualquer adquirente ou banco. Cada tenant poderá vincular a(s) conta(s) financeira(s) de sua própria titularidade, escolher seus provedores e receber diretamente. FM Tecnologia não será custodiante ou recebedora de pagamentos dos clientes.

## Catálogo de integrações para engenharia
- IMPLEMENTADO EM CÓDIGO, SEM ATIVAÇÃO/HOMOLOGAÇÃO EXTERNA: Mercado Pago Pix.
- CANDIDATOS A ADAPTERS REAIS, A VALIDAR CONTRATOS/ACESSO: Efí, Asaas, Pagar.me, Banco Inter, Banco do Brasil, PagBank, Stone, Sicoob e Sicredi.
- PADRÃO DE INTEROPERABILIDADE: API Pix do Banco Central (Cob, CobV, txid, consulta, webhooks), quando suportada pela instituição.
- MEIOS NÃO BANCÁRIOS: dinheiro, cartões na entrega, chave Pix manual; a ausência de confirmação API impede marcar recebimento automaticamente.

## Componentes-alvo
1. Provider Catalog: lista capability real por PSP e estado de homologação, sem apresentar provedores candidatos como ativos.
2. Merchant Payment Connections: vinculações segregadas por tenant/unidade; seleção do banco/PSP; aprovação do titular; versionamento e rotação de credenciais via Vault; verificação do recebedor.
3. Payment Orchestrator: roteamento determinístico e política de prioridade/configuração por estabelecimento, sem dependência direta de fornecedor.
4. Provider Adapter Fabric: implementações independentes de createPix, status, refund, validateWebhook, normalizeWebhook; mapeamento de erros e estados.
5. Payment Ledger: valor, currency, quote/order ID, provider ID, merchant ID, txid/endToEndId e trilha imutável de tentativas/eventos.
6. Reconciliation & Recovery: status confirmado somente via consulta autenticada do PSP, correlação amount/tenant/recipient, compensação e filas de retry.
7. Channel Adapter: enviar cobrança e orientar cliente sem expor segredos nem declarar pagamento com base em mensagens ou screenshots.

## Invariantes operacionais
- Sem conexão validada com o recebedor, não criar cobrança.
- Nunca confundir chave Pix ou imagem com pagamento confirmado.
- Fallback na criação entre PSPs é proibido sem verificar status da primeira tentativa, para evitar cobrança duplicada.
- Uma transação fica vinculada ao PSP de origem para consulta, estorno e conciliação.
- Webhooks de PSPs exigem autenticação e escopo derivado da conexão confiável, nunca do corpo informado pelo remetente.
- Não concentrar credenciais de todos os tenants em variáveis globais como solução comercial definitiva.
- A integração existente Mercado Pago permanece como provider opcional, não default global obrigatório.
- Nenhum adapter é considerado pronto por ter apenas testes simulados; exigir sandbox e integração real antes de produção.

## Implementação atual versus alvo
No HEAD de 20/11/2026, src/payments/routes.ts instancia MercadoPagoPixProvider a partir de variáveis globais MP_PIX_* e, na ausência delas, StructuralPaymentProvider. Portanto, a aplicação NÃO é ainda multi-PSP operacional. Este ADR é a decisão arquitetural e um mapa de requisitos, não homologação.

## Sequência técnica da fase
A. Criar registry e resolver de conexões por tenant com credenciais Vault e fail-closed.
B. Separar instância de PaymentService da decisão do PSP e persistir provider escolhido por cobrança.
C. Implementar adapters Efí, Asaas, Inter, BB e Pagar.me com testes de contrato comuns; ampliar conforme demanda.
D. Centralizar validação e reconciliação de webhooks e Pix.
E. Integrar ao checkout/WhatsApp, homologar ambiente bancário e somente então realizar deploy controlado e ativação.

## Fontes oficiais
- Banco Central: https://www.bcb.gov.br/estabilidadefinanceira/pix-cobranca
- API Pix Bacen: https://github.com/bacen/pix-api
- Inter: https://developers.inter.co/docs/introducao/nossas-apis
- Banco do Brasil: https://www.bb.com.br/site/developers/api-pix/
- Efí: https://dev.efipay.com.br/docs/api-pix/cobrancas-imediatas/
- Pagar.me: https://docs.pagar.me/reference/pix-2
