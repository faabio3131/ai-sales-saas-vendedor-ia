# Multi-PSP Payment Fabric — implementação de fundação
20/11/2026 — tenant-scoped.
- src/payments/providerCatalog.ts contém candidatos e estado explícito PLANNED/ADAPTER_IMPLEMENTED.
- src/payments/connections.ts provê preferências por estabelecimento e leitura de conexões emitidas por processo de provisionamento confiável. HTTP não aceita criação de conexão ativa nem credenciais.
- src/payments/resolver.ts decide adaptador por tenant e por provedor persistido na cobrança, exigindo ACTIVE, recebedor verificado e referência de Vault. Não há fallback de criação automático.
- POST /api/payments aceita providerId opcional para transações online; sem seleção ou preferência falha fechado.
- GET /api/payments/providers, GET /api/payments/connections e PUT /api/payments/connections/preference. Todas sob autenticação + membership de tenant; escrita de preferência OWNER.
- O adapter Mercado Pago está vinculado às credenciais de uma única conta em variáveis de ambiente. O resolver rejeita qualquer outro tenant ou recipient; isso **não** implementa BYOK multi-tenant ainda.
- Não existe API para inserir segredos, uma decisão intencional; próximo ciclo: Secret Manager por tenant, provisionamento e revogação governados, adaptadores Efí/Asaas/Inter/BB/Pagar.me, testes sandbox/produção e integração WhatsApp.
- Nunca marcar candidato como homologado.
