# T08.2 — Provisionamento bancário e WhatsApp por empresa (runbook operacional)

**Separação obrigatória:** este documento descreve a engenharia de integração. Configurar um metadado de provedor em ambiente de testes **não** equivale a criar conta bancária, validar identidade da empresa, autorizar canal WhatsApp ou realizar Pix real. A homologação comercial é externa e **não paralisa a construção de T08.3 e seguintes**.

## Contratos existentes integrados

- T01: cookie autenticado + membership ativo de tenant; nenhuma rota de gestão de credenciais dispensa esses controles.
- T04: `PaymentService`, `TenantPaymentProviderResolver`, `MerchantPaymentAdapterFactory`, `GoogleSecretManagerMerchantVault`, `MountedMerchantCredentialsVault`, processador de callbacks por provedor, recepção com body bruto, reconciliação e order payments.
- T08.1: configurações por tenant/unidade sob `/api/establishments`; a escolha de modo operacional não pode habilitar banco, canal ou cozinha.

## 1. PSP/Pix — cadastro configurável, sem credenciais em Firestore

- `GET /api/payments/providers` lista provedores e maturidade, sem prometer disponibilidade bancária.
- `GET /api/payments/connections` devolve apenas status e flags (nunca referências de cofre, tokens ou destinatário).
- `POST /api/payments/connections/enroll` aceita **somente** `{providerId, recipientId}` de membro autenticado `OWNER`; gera conexão `PENDING_VERIFICATION`, com CAS/versionamento. `providerId` deve ter adaptador implementado; não pode ativar serviços em `CONTRACT_PENDING` ou `PLANNED`.
- `PUT /api/payments/connections/preference` aceita somente provedor com adaptador implementado. A preferência **não** contorna a exigência de conexão `ACTIVE` e cofre correto no Payment Engine.
- `MerchantProviderOnboardingService.attachVault` é uma **função restrita para operador do sistema**, **não exposta no HTTP do lojista**; a referência é calculada a partir de tenant/provedor. Nunca aceitar referência arbitrária fornecida por cliente.
- `verifyAndActivate` requer prova externa real de um `ExternalPaymentVerifier` independente, com referência imutável `external:...`. Não há verificador de prova real instalado no endpoint do lojista; a implementação HTTP é intencionalmente incapaz de ativar conta sozinha.
- `disable` é operação interna de contingência. Reenrolar outro beneficiário revoga referência pendente antiga; conexão ativa não pode ser substituída silenciosamente.

### Cofres operacionais

**Cloud:** `PAYMENT_VAULT_BACKEND` diferente de `MOUNTED` usa GCP Secret Manager e identidade do workload. Cada chave é acessada via Secret Manager (roles/secretmanager.secretAccessor restrito ao segredo específico), com nome determinístico `avpay-<hash>` e referência `projects/<projectId>/secrets/avpay-<hash>/versions/latest`. Não conceder IAM amplo ao serviço de frontend. Rotacionar e registrar a versão implantada; evitar logs de token.

**Contabo/Linux:** `PAYMENT_VAULT_BACKEND=MOUNTED` e `PAYMENT_SECRET_MOUNT_DIR` apontam para arquivos gerados fora do repositório, root-managed, privados 0600, diretório não symlink, volume read-only. O nome é derivado de `mountedSecretReference(tenantId,providerId)`. JSON deve estar vinculado a `tenantId`, `providerId` e `recipientId` exatos. As permissões e o conteúdo são validados antes do uso. Nenhum certificado deve entrar no Git.

**Provedores já existentes:** Mercado Pago, Efí, Asaas, Pagar.me, Inter, Banco do Brasil e PagBank têm adaptadores de criação/consulta testados na engenharia. **Santander/Itaú permanecem CONTRACT_PENDING; Stone/Sicoob/Sicredi permanecem PLANNED.** Não declarar homologação real destes bancos sem contrato e evidência. A disponibilidade de webhooks é **por provedor**, não presumida; provedores sem callback autenticado utilizam reconciliação em vez de confiar em payload externo.

## 2. WhatsApp oficial — configuração por tenant/unidade

1. Um `OWNER` registra somente IDs Meta do número e da WABA: `POST /api/channels/whatsapp/units/:unitId/register` com `{phoneNumberId,wabaId}`; a conta nasce `PENDING_VERIFICATION`, sem permissão de enviar/receber tráfego.
2. `GET /api/channels/whatsapp/units/:unitId` e `GET /api/channels?unitId=...` apresentam somente status e flags de configuração.
3. Equipe autorizada instala **fora do Git e fora do formulário** o segredo da WABA: `tenantId`, `unitId`, `phoneNumberId`, `wabaId`, `accessToken`, `appSecret` e `verifyToken`. GCP usa `avwa-<hash>`; Linux usa arquivo `<hash>.json` sob `WHATSAPP_SECRET_MOUNT_DIR` em modo 0600 (com `WHATSAPP_VAULT_BACKEND=MOUNTED`). Todos os identificadores devem corresponder ao registro da unidade.
4. Operações invoca `WhatsAppRegistrationService.attachVault` fora da API do lojista. A Meta aponta o callback específico do tenant/unidade:
   `https://<host-certificado>/api/channels/webhooks/whatsapp/:tenantId/:unitId`.
5. A Meta envia `GET hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`; o servidor responde o challenge **somente** com token correto do cofre. Essa etapa pode ocorrer em estado PENDING, **sem ativar atendimento**.
6. `verifyAndActivate` é exclusivamente operacional e requer prova real de inscrição WABA/número. Sem um `WhatsAppExternalVerifier` com prova verificável, não ativa.
7. POST webhook exige HTTPS no edge da implantação, corpo bruto original com `X-Hub-Signature-256` válido (HMAC-SHA256 de `appSecret`), WABA exata, `phone_number_id` exato e conexão ativa; rejeita mistura de tenants/números. Eventos legítimos são normalizados e persistidos em `whatsappInboundInbox`; duplicatas são ignoradas com chave tenant+unidade+telefone+mensagem. Em falha de Firestore, responde 503 para possibilitar retry. Eventos de status sem mensagem não são inventados como vendas.
8. Envio: `WhatsAppDeliveryService` (worker interno, **não** endpoint arbitrário público) usa a Cloud API oficial em `graph.facebook.com/v26.0/<phone_number_id>/messages` (versão configurável por `WHATSAPP_GRAPH_VERSION`), somente com conexão ACTIVE, consentimento/política upstream **e mensagem recebida comprovada na janela de 24 horas**. A prova está no inbox assinado; requer o índice composto `deploy/whatsapp.firestore-indexes.json`. `FirestoreWhatsAppOutbox` aplica reserva determinística; em resposta ambígua registra `UNKNOWN` e proíbe reenvio cego para evitar duplicidade.
9. Somente mensagens de texto dentro da janela de atendimento são implementadas nesta etapa; **templates, conversação de IA/CRM e 10 jornadas reais seguem T08.4**, sem inventar envio de campanhas ou políticas Meta ainda não verificadas.

## 3. Segurança, observabilidade e isolamento

- Múltiplos tenants e unidades coexistem com metadados separados; `tenantId` e `unitId` **nunca** são confiados a payload de webhook sem HMAC e vínculo de conta.
- Não armazenar token, certificado ou app secret em `merchantPaymentConnections`, `merchantWhatsAppConnections`, logs, dashboards, cookies, payload de resposta ou repositório.
- Firestore `whatsappInboundInbox` contém texto real de mensagens; aplicar controles de acesso/retention e política LGPD do projeto, criptografia em repouso e restrição a serviços autorizados. Nenhum webhook é usado para atribuir identidade financeira ou marcar Pix como pago.
- Webhook financeiro usa confirmação por consulta oficial ao provedor e reconciliação periódica existentes de T04; não deve confiar em `status` do POST externo.
- Em operação real, instalar/validar Firestore indexes, monitorar filas `RECEIVED` e `UNKNOWN`, retenção e dead-letter, rotação de segredos e rate limiting por tenant. A publicação dos recursos e testes live fica sob T08.3/T08.4.

## 4. Gates de aceitação

**ENGENHARIA T08.2:** código genérico, isolamento por empresa/unidade, CAS, vault/binding, webhooks oficiais e segurança, HTTP validado, inbox/outbox, Graph transport, mocks determinísticos, build/typecheck/testes e CI cumulativa aprovados.

**HOMOLOGAÇÃO EXTERNA PENDENTE (não bloqueia T08.3 interna):** credenciais reais depositadas em cofre autorizado, verificação do beneficiário no PSP, challenge real Meta, inscrição da WABA, HTTPS de produção, webhook de cobrança real, prova de uma transação Pix real reconciliada, consentimento e jornada real com a cliente, certificação e autorização de go-live.

Referências oficiais: [Meta Graph Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/) e [GCP Secret Manager best practices](https://docs.cloud.google.com/secret-manager/docs/best-practices).
