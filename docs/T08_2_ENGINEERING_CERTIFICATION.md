# T08.2 — Certificação interna da integração PSP + WhatsApp

**Data:** 21/11/2026.  
**Status:** implementação da T08.2 aprovada na CI da branch da PR #22; **nenhum PSP, número Meta ou empresa real foi ativado**. Commit operacional certificado: `845c7364eedfe19b5360659553c73effffa5ec48`. CI #44966258243 — SUCCESS; testes TypeScript 375 PASS, Python 7 PASS, Docker 374 PASS + 1 SKIP por ambiente, zero falhas. As revisões documentais posteriores não alteram código executável.  
**Regra de promoção:** revisão e CI da PR no SHA final, merge e CI pós-merge da `main` SUCCESS. O histórico da PR #22 e a execução pós-merge constituem a evidência final desses dois últimos gates; o documento não presume que ocorreram antes do merge. T08.3 pode avançar em **engenharia** após a CI pós-merge, sem depender de credenciais reais. Esta certificação não constitui homologação comercial.

## Matriz de funcionalidades e verificações de engenharia

| Domínio | Contrato de implementação | Evidência de teste |
|---|---|---|
| PSP multiempresa | OWNER solicita vínculo por tenant, status PENDING_VERIFICATION, whitelist de adaptadores, CAS, re-enrollment e bloqueio de troca ACTIVE | `tests/t08_2MerchantConnections.test.ts` |
| Cofres bancários | GCP Secret Manager com IAM ou mount 0600; referência determinística, vínculo tenant/provedor/recebedor; nenhum segredo no Firestore | `tests/merchantMountedVault.test.ts`, testes T08.2 |
| Governança externa | `verifyAndActivate` só em serviço operacional, requer verificador independente e prova `external:...`; loja não consegue ativar via HTTP | `tests/t08_2MerchantConnections.test.ts` |
| Payment Engine | T04 multibanco preservado: Pix, consultas/valores e idempotência, webhooks autenticados e reconciliação por GET oficial | `tests/bankAdapters.test.ts`, `tests/paymentWebhooksReconciliation.test.ts` |
| PagBank Order | `x-payload-signature` ECDSA sobre bytes brutos; chave pública do provedor fixa no cofre; pedido ORDE único; reconciliação, sem confiar no payload | `tests/t08_2PagBankSignedWebhook.test.ts` |
| Canal WhatsApp por unidade | OWNER fornece apenas IDs Meta; CAS; `phone_number_id` reservado globalmente contra colisões; status PENDING sem ativação | `tests/t08_2WhatsAppCloud.test.ts` |
| Cofre WhatsApp | Google Secret Manager ou mount 0600, binds tenant/unidade/número/WABA e tokens somente no servidor | `tests/t08_2WhatsAppCloud.test.ts` |
| Meta GET | `hub.challenge` e token do cofre com comparação segura; funciona no PENDING sem ativar o atendimento | `tests/t08_2WhatsAppCloud.test.ts` |
| Meta POST | HMAC-SHA256 `X-Hub-Signature-256` sobre raw body; WABA/phone/tenant vinculados; sem mensagens falsas em caso de erro | `tests/t08_2WhatsAppCloud.test.ts` |
| Inbox durável | Inbound assinado armazenado por tenant/unidade; create atômico, deduplicação por mensagem, falha retorna 503 | `tests/t08_2WhatsAppCloud.test.ts` |
| Sender Meta | HTTPS fixo Graph API, texto somente dentro da janela real de atendimento verificada no inbox, outbox fail-closed com estado UNKNOWN | `tests/t08_2WhatsAppCloud.test.ts` |
| UI OWNER | Cadastro de PSP/WhatsApp por empresa, somente identificadores; painel exibe estados sem mostrar referências de cofre, chaves ou tokens | `src/ui/ProviderConnectionPanel.tsx` + build/typecheck |
| Infraestrutura | Índice composto para inbox/24h, mount privado e descrição de operação sem informações de cliente embutidas | `deploy/whatsapp.firestore-indexes.json` e `docs/T08_2_SECURE_PROVIDER_ONBOARDING.md` |

## Certificação da branch e critérios de promoção

- [x] Build + typecheck no commit funcional `845c7364eedfe19b5360659553c73effffa5ec48`.
- [x] Testes cumulativos (375 TS PASS / 7 Python PASS), mocks Pix/WhatsApp, PagBank ECDSA, isolamento e HTTP de segurança.
- [x] Docker API, worker cognitivo e configuração do reconciliador: 374 PASS / 1 SKIP.
- [x] CI da branch #44966258243 SUCCESS no SHA funcional.
- **Gates de promoção:** PR #22 mergeada em `main` e CI integral pós-merge no SHA resultante, com resultados registrados na PR. O aceite comercial permanece externo.

## Dependências externas, separadas da engenharia

- [ ] Clientes com identidade real, chaves PSP, certificados mTLS, conta/identidade de beneficiário e contrato habilitados.
- [ ] Token Meta, App Secret, Phone Number ID/WABA reais vinculados, webhook HTTPS publicado e handshake da Meta real.
- [ ] Homologação com Pix verdadeiro e consulta independente; callbacks reais, janela de conversa e política da Meta.
- [ ] T08.3: scripts, backup/restore e rollback com provas da topologia de destino; T08.4: 10 jornadas reais; T08.5: autorização explícita do Diretor.

Esses itens externos permanecem NO_GO e **NÃO impedem que a engenharia sequencial da T08.3 se inicie após certificação da T08.2**.
