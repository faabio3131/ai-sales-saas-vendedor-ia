# Cobertura multibanco — adaptadores Pix (20/11/2026)

## Implementações de engenharia
- Efí, Banco Inter, Banco do Brasil: `PixCobBankProvider` (Pix Cob v2, cobrança determinística por txid, verificação de liquidação via API e divergência de valor).
- Asaas: `AsaasPixProvider` (criação de cobrança de cliente previamente mapeado, QR Code e consulta).
- Pagar.me: `PagarmePixProvider` (orders v5, Pix, charge e consulta).
- Secret Manager: `GoogleSecretManagerMerchantVault` lê segredos apenas por workload identity de conexão ativa, compara tenant, PSP e beneficiário.
- Transportes HTTPS com certificados mTLS para bancos, OAuth e credenciais seguras; destinos configurados fixamente e sem host arbitrário vindo de dados.
- Tenant resolver: carrega adapter da conexão ativa sem misturar contas, mantém provider sticky para reconciliação.
- Falha fechada em métodos não suportados, sem inventar Pix, confirmação, QR ou estorno.
- O fluxo de cobrança mantém idempotencyKey local; instituições que não fornecem idempotência robusta precisam de reconciliação após timeouts antes de novas tentativas.

## Status e limites operacionais
**Código implementado não significa homologado externamente.** Todos os cinco conectores precisam de credenciais reais e teste sandbox, análise de resposta dos bancos e comprovantes. Os modos de notificação específicos dos cinco não estão habilitados: status confirmado deve vir de consulta à API autenticada, usando refresh/reconciliation. Nenhum webhook genérico sem assinatura ou mTLS será aceito. Os canais e o pedido da pizzaria ainda precisam de integração. Não há deploy Contabo desta alteração.

## Provisionamento governado
Documento `merchantPaymentConnections/{tenantId}__{providerId}` com status ACTIVE, recipientId e credentialRef. Uma autoridade operacional deve verificar titularidade e gravar somente referência ao segredo existente. O segredo JSON deve conter tenantId, providerId, recipientId e chaves específicas; nunca colocar segredo no Firestore nem nas APIs públicas. Para Asaas/Pagar.me, mapear previamente cliente interno em `merchantProviderCustomers` (projeto/tenant/provedor/cliente). Não habilitar conexão antes de conciliar o recebedor.

## Referências oficiais
- Efí: https://dev.efipay.com.br/docs/api-pix/cobrancas-imediatas/
- Asaas: https://docs.asaas.com/docs/cobrancas-via-pix
- Inter: https://developers.inter.co/duvidas-frequentes
- Banco do Brasil: https://www.bb.com.br/site/developers/api-pix/
- Pagar.me: https://docs.pagar.me/reference/pix-2
