# Pagamentos — webhooks autenticados e reconciliação periódica

Data: 2026-11-21. Status: engenharia interna; não equivale a homologação bancária externa.

## Endpoint de recebimento
`POST /api/payments/webhooks/:provider/:tenantId`, apenas para `ASAAS`, `PAGARME`, `EFI`, `BANCO_INTER`, `BANCO_DO_BRASIL`.

O tenantId na URL é **somente seletor não confiável**. A conexão deve existir, estar ativa, ter recebedor e referência de cofre, e os segredos recuperados têm de coincidir com tenant+provider+recipient. O pagamento recebe somente atualização após consulta oficial ao provedor, correlação com paymentId persistido e verificações de valor/referência. A mensagem do webhook **não** determina o status.

- Asaas: header `asaas-access-token` validado em tempo constante contra um webhookSecret independente da API key. O evento fornece `payment.id`. Ref: https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
- Pagar.me: exigida assinatura `x-hub-signature` como HMAC-SHA256 sobre bytes originais do corpo com webhookSecret; payload deve apontar para `data.order.id` ou `data.id` de ordem. A assinatura e o payload devem ser homologados especificamente para Core v5. **Não** aceitar assinatura de versões anteriores sem revisão.
- Efí: requer mTLS real na borda do servidor; o proxy deve verificar a cadeia pública oficial da Efí e só então assinar o corpo original que encaminha à aplicação. A Efí acrescenta `/pix` em determinadas URLs; configurar correspondência no proxy. Ref: https://dev.efipay.com.br/docs/api-pix/webhooks/
- Inter/BB: a recepção depende do contrato de callback e da validação de certificado mTLS na borda. O mesmo envelope interno autenticado pode transportar notificações no formato Pix Cob; homologar formato e confiança do certificado individualmente.

### Envelope do relay (apenas bancos)
`x-av-relay-timestamp`: Unix epoch segundos.
`x-av-relay-signature`: HMAC-SHA256 hex dos bytes `provider + '\\n' + tenantId + '\\n' + timestamp + '\\n' + rawBody`, usando a chave `webhookSecret` exclusiva da conexão. Recusar idade acima de cinco minutos.

**Proteção obrigatória:** a borda mTLS deve ter CA/certificado revogado e validação rigorosa, ser a única origem capaz de acessar a rota de relay e não aceitar cabeçalhos externos `x-av-relay-*` sem removê-los. Em produção o HMAC é proteção adicional, não substitui mTLS. Não gravar segredos ou corpos completos nos logs. O destino do relay deve ser um serviço privado.

## Reconciliação contínua
`npm run reconcile:payments` executa uma rodada independente:
- Varre cobranças por estado com cursores persistentes e rotativos em Firestore, evitando starvation por grandes volumes de pagamentos offline; processa até 100 por rodada.
- Reserva lease transacional por paymentId por até 2 min, evitando que dois workers operem simultaneamente.
- Consulta o provedor **original** usando conexão tenant-scoped e recupera estado oficial.
- Verifica valor/referência, registra estado e aciona observer fiscal idempotente.
- Retentativa escalonada (até uma hora) se a API estiver indisponível.
- Loga apenas contagens e erro genérico; nunca dumps de credenciais.

**Programação operacional:** implantar o comando em job/cron isolado, com período sugerido de cinco minutos. Não rodar múltiplas instâncias com cron in-process no backend HTTP. O serviço demanda Firestore e identidade de acesso ao cofre (ou volume de segredos). Monitorar falhas e registrar alarmes; sem cron configurado o código não executará periodicamente.

## Limites e gates
- Webhook válido não é prova de liquidação; somente GET assinado ao provedor determina estado.
- Retentativas dependem do PaymentService atual; a atomicidade entre Payment.status, fiscal observer e webhook ledger ainda deve ser fortalecida com outbox em etapa de hardening.
- Falhas de criação incertas mantêm a reserva de tentativa, proibindo recriar cobrança sem reconciliação.
- Transações financeiras reais, certificados, credenciais e deploy Contabo são dependências externas não homologadas aqui.
- PagBank e Mercado Pago utilizam mecanismos próprios: Mercado Pago já possui endpoint dedicado; PagBank deve aguardar validação do contrato de webhook (mas suas cobranças online serão consultadas pelo reconciliador).
- Não habilitar endpoints para empresas sem conectar a conta e validar titularidade.
