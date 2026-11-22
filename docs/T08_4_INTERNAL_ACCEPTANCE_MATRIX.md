# T08.4 — Matriz de homologação **interna** das dez jornadas (sem go-live)

**Dependência comprovada:** T08.3 PR #23, merge `cdf19a8657c46e60c023918c5675204ce98ba89e`, CI pós-merge `44969942528` SUCCESS.  
**Escopo autorizado:** engenharia, teste em doubles e certificação interna. **Não** habilita banco, Meta, PDV/ERP real, cloud de produção ou atendimento da Pizzaria Americana. O negócio do teste `pizza-a` e CEPs/valores são apenas fixtures artificiais; o usuário real é configurado no Firestore por tenant e unidade.

## Critérios técnicos — 10 jornadas, prova automatizada

| Jornada | Teste de aceite executável | Evidência exigida |
|---|---|---|
| **J01 Atendimento** | `tests/t08_4PilotJourneys.test.ts` / J01 | Fato aprovado e catálogo versionado; não inventa horário, preço da pizza sem opções nem capacidades inexistentes; proíbe contexto de outro tenant |
| **J02 Pedido** | J02 | Pizza meia-meia MAX_FLAVOR + borda + adicional em centavos; confirmação explícita referenciada; sequência monotônica e idempotência |
| **J03 Entrega** | J03 | Taxa/área configurada e CEP válidos antes da confirmação; CEP fora de cobertura e endereço sem CEP bloqueados; retirada com taxa zero |
| **J04 Pix** | J04 | PSP **fake** devolve payload Pix de demonstração (não QR Pix homologado); callback ASAAS autenticado; consulta independente GET; repetição não confirma em duplicidade |
| **J05 Produção** | J05 | Pedido real da camada de domínio, pagamento associado, liberação negada antes de confirmação externa e idempotência de envio nativo |
| **J06 Notificação** | J06 | Apenas evento persistido autoriza aviso, com número de pedido, confirmação operacional, início de preparo, pronto, saída e conclusão |
| **J07 Financeiro** | J07 | Fonte do ledger T03/T04, consulta do proprietário para dia/semana/mês, reconciliação sem lucro/taxas inventados, RBAC |
| **J08 Exceções** | J08 | Pagamento expirado e valor divergente, mesmo idempotency key, tentativa de nova cobrança, edição/cancelamento versionados |
| **J09 Isolamento** | J09 | Proibição cross-tenant e cross-unit de pedidos, pagamentos e relatórios |
| **J10 Resiliência** | J10 | Rota de IA indisponível falha fechada; ACK perdido após entrega ao PDV de simulação, retomada do worker, uma única ordem externa |

**Importante:** J04 só atesta os contratos de autenticação e reconciliação dos PSPs em sandbox/test doubles; QR real e baixa bancária pertencem à homologação externa individual.

## Certificação adicional obrigatória dos dois modos

Arquivo: `tests/t08_4ModesAndWhatsApp.test.ts`.

| Modo/risco | Gate |
|---|---|
| **NATIVE_OPERATIONS** | Painel KDS/fluxo nativo (fila, START, READY, DISPATCH_DELIVERY, COMPLETE); zero chamadas ao PDV |
| **INTEGRATED_OPERATIONS** | Comando único por idempotency key, ACK verificado e persistido antes de notificar, status autenticado e sequenciado, deduplicação de replay |
| **ACK ambíguo** | Timeout com pedido já recebido pela cozinha externa; mesma chave em retry após restart, sem segundo pedido |
| **Conector indisponível** | DLQ + revisão humana sem downgrade para fila nativa |
| **Troca de modo** | Troca negada com operações abertas; conector não certificado não existe no runtime padrão |
| **WhatsApp oficial** | Sender de produção conectado ao vínculo Meta tenant/unidade T08.2, cofre, inbox assinado 24h, outbox idempotente, flags T08.3 fail-closed |
| **Integridade de notificações** | Status confirmado e entrada em preparo persistidos; WhatsApp só dispara com identidade derivada de assinatura externa; canal legado bloqueado em produção |

### Ensaios CI obrigatórios

- `npm run build` / `npm run typecheck` / `npm test` / 7 testes Python cognitivos / 8 testes Python de operações T08.3
- `npm test -- tests/t08_4PilotJourneys.test.ts tests/t08_4ModesAndWhatsApp.test.ts`: gate explícito das dez jornadas + dois modos.
- Segurança de runtime, PSP, sandbox Compose/rollback e smokes Docker de imagem de produção, staging isolado, Core privado.
- PR no SHA final aprovada na CI, revisão e merge; CI integral pós-merge `main` verde.

## Pendências EXTERNAS isoladas — **NO_GO**

- Cadastro/aceite da proprietária da Pizzaria Americana, horários, endereço, cardápio, zonas de entrega, atendente e modo operacional real configurados e autorizados por tenant/unidade.
- Credenciais PSP, baixa Pix real, webhook real, canais Meta autorizados, ambiente Cloud Run/Contabo, certificados, PDV real integrado se modo escolhido.
- **10/10 jornadas externas** ainda não homologadas; não confundir fixtures com prova real, dinheiro real, contato real ou aprovação T08.5.
- Backup/restauração GCP real/RPO/RTO e eventual deploy controlado de staging externo são frentes operacionais independentes da homologação das dez jornadas.
- Go-live somente com evidências externas e autorização formal na T08.5.

**Regra de sequência:** o gate para avançar à engenharia horizontal T09 é **CI interna T08.4 certificada**, e não homologação externa nem liberação T08.5. Não entregar relatórios de lucro, rastreamento GPS ou confirmação de pagamento sem comprovação da fonte.
