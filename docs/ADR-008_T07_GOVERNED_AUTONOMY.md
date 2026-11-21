# ADR-008 — T07: autonomia comercial governada e Tool Gateway

**Escopo:** engenharia interna T07, não é autorização de implantação externa, homologação WhatsApp/Pix ou go-live.

## Decisão arquitetural
A recomendação do modelo é **dado não confiável**, nunca uma permissão, comprovante ou execução. A única superfície de execução governada é `POST /api/autonomy/units/:unitId/execute`, com sessão autenticada, membership ativa e `TenantContext` obtido no servidor. O payload **não aceita** `tenantId`, `role`, `OPERATION_MODE`, `refund`, `finance`, `status`, `connectorId` nem ferramenta fora de allowlist. Comandos passam por serviços de domínio T03, T04 e T06; o gateway não altera diretamente valores, status financeiros ou estados de cozinha.

### Modos por unidade
| Modo | Leitura de status | Ações de escrita | Execução financeira |
|---|---|---|---|
| `ASSIST` | Permitida quando habilitada | Somente após aprovação humana específica | Após confirmação real de cliente + aprovação + políticas T04 |
| `COPILOT` | Permitida quando habilitada | Somente após aprovação humana específica | Após confirmação real de cliente + aprovação + políticas T04 |
| `AUTONOMOUS_GOVERNED` | Permitida quando habilitada | Apenas allowlist publicada pelo OWNER/ADMIN; limites de valor e provas canônicas | Apenas pedido confirmado, prova confiável, risco liberado e valor dentro do limite ou aprovação válida |

**Default absoluto:** sem política publicada, `ASSIST` + allowlist vazia + limites zero. `AUTONOMOUS` legado é recusado como autorização de execução. Publicar política exige versão esperada e OWNER/ADMIN; as políticas são isoladas por tenant/unidade e não podem alterar o modo `NATIVE_OPERATIONS`/`INTEGRATED_OPERATIONS` do Food Pack.

### Allowlist estrita
`ORDER_STATUS` (somente snapshot persistido), `ORDER_DRAFT` (T03 + pricing), `ORDER_CONFIRM` (T03 + prova exata de cliente + origem assinada), `PAYMENT_CREATE` (T04 + referência/total e PSP/recebedor da empresa), `PRODUCTION_RELEASE` (T06 + pagamento confirmado ou modalidade autorizada e configuração de conector), `RECOVERY_PREPARE` (somente preparação da recuperação mediante consentimento). Não há ferramentas para `REFUND`, `FINANCE_QUERY`, `SET_OPERATION_MODE`, `SEND_WHATSAPP`, `FORGE_STATUS`, descontos por prompt ou ativação de PDV não homologado.

### Aprovação humana e recibos
- `governanceUnitPolicies`: escrita versionada com transação/CAS.
- `governanceApprovals`: decisão OWNER/ADMIN imutável, unida a tenant/unidade, usuário executor, ferramenta, fingerprint completo da solicitação, versão de política, teto monetário e prazo máximo de 1 hora; revogação/consumo transacionais. Não substitui a confirmação expressa do cliente.
- `governanceToolReceipts`: reserva atômica por tenant/unidade/idempotencyKey, com fingerprint e ator. `RESERVED → COMPLETED` ou `REVIEW_REQUIRED`; incerteza de PSP/PDV ou crash não reexecuta efeito. Replay completo retorna o recibo, enquanto replay incerto ou mesmo key com payload diferente falha fechado.
- O resultado auditável expõe apenas IDs e estados necessários, não segredos, corpo inteiro de conversa nem tokens de PSP.

### Identidade assinada, risco e recuperação
`governanceTrustedInboundMessages` é uma coleção de provas que somente um ingresso de provedor **com assinatura validada** poderá preencher; mensagens criadas por funcionários no CRM não são evidência suficiente. `VerifiedCommercialChannelIngress` existe como serviço privado sem endpoint de Internet: ele valida assinatura, vínculo número-cliente-conversa, mensagem persistida, origem e referência. T08 deverá conectar o webhook oficial a esse contrato, sem assumir homologação.

`governanceOrderRiskAssessments` somente libera automação após avaliação de mensagem proveniente de canal confiável; ausência de prova é risco não liberado. Sinais de alergia, disputa, desconto fora de política e prompt injection permanecem bloqueados mesmo que uma mensagem posterior seja limpa; a exceção exige processo humano separado.

`governanceTrustedContactConsents` preserva opt-in/opt-out explícito proveniente de mensagem assinada. Recuperação governada apenas cria ação preparada; **nunca envia uma oferta** diretamente no gateway, nem contorna opt-out. Notificações operacionais continuam propriedade do outbox de eventos persistidos da T06 e seu conector real pertence à T08.

### Estados de checkout e produção
A trilha canônica é `ORDER_DRAFT → ORDER_CONFIRM → PAYMENT_CREATE → PRODUCTION_RELEASE`; T03 confirma valor/versão e mensagem original, T04 verifica pagamento e T06 decide uma única fila nativa ou um único envio externo aguardando ACK. Mensagem de IA jamais confirma pagamento, liberação ou entrega. Em modo integrado, o gateway retorna `AWAITING_ACK` até a integração produzir prova assinada; um ACK falso não pode ser produzido por esse endpoint.

### Não objetivos / gates externos
Sem disparos reais de Pix, credenciais de banco/WhatsApp, publicação em Contabo ou atualização automática da revisão Cloud Run. Esses gates são T08.1–T08.5. Não declarar que um texto do usuário é um webhook assinado, que uma CI prova integração com PSP externo, ou que `ASSIST` é consentimento de envio comercial.
