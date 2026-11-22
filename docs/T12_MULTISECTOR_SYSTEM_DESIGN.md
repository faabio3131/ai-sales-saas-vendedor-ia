# T12 — Comércio, serviços e onboarding multissetorial



Base: T11 PR #27, main 98ebcbc772bb847c66ac15f1a832f265042f3e3d; CI pós-merge #44980958696 SUCCESS. T12 realiza a evolução final prevista no cronograma, sem substituir os domínios já certificados.

## Modelos e governança

Sete modelos: restaurante, varejo, serviços profissionais, salão, barbearia, estética administrativa e geral; cada um em NATIVE_OPERATIONS ou INTEGRATED_OPERATIONS. T09 registry mantém dependências. Onboarding OWNER/ADMIN exige assinatura ativa, cria perfil T02 e assignment T09 v1 mais marcador numa única transação; replays idênticos retornam a criação, diferenças conflitam. Não sobrescreve estabelecimento existente; use revisões e rollback já disponíveis. Nome, endereço, contato, horário, fuso, assistente e retenção são dados da unidade; serviços/profissionais/preços são configurados posteriormente. Modelos são dados de configuração, Core não muda para cada empresa.

Modo integrado provisiona apenas conhecimento/CRM (e catálogo informativo no varejo). Não duplica ordens nem reservas; não pressupõe integração com PDV/KDS/agenda/ERP e não cria falso ACK. Adaptadores opcionais existentes (PSP, PDV T06, Meta T11) permanecem segregados; outros sistemas exigem contrato e homologação própria, sem impedir modo nativo.

## Motor de varejo

`retailUnits/{hash(tenant,unit)}` é fence e contador de ordens confirmadas; subcoleções catalog/current, catalogVersions, stock, orders/{id}/versions, receipts e movements. Catálogo imutável por revisão e identidade SKU estável (desativar, não excluir); preço em centavos, categoria, indicador de estoque. Carrinho deriva snapshots/total da versão, cliente ativo, idempotência, sem reserva. Editar carrinho reprecifica; confirmação requer aceite humano explícito para o valor e versão vigentes, reserva estoque atômica. CONSUME baixa saldo só após pagamento ou total zero; CANCEL libera reserva, nunca confunde estorno. Ajuste de estoque OWNER/ADMIN CAS, motivo e histórico, jamais abaixo de reservado. Não é ERP/estoque avançado. Capabilities/vertical/modo/catálogo não podem ser retirados enquanto ordens confirmadas estiverem abertas.

RBAC + tenant/unit do contexto autenticado. A transação lê perfil, assignment e assinatura antes de criar catálogo/checkout/reservar estoque; disputa do último item não vende acima do saldo. Se assinatura expirar, não abre novas operações; cancelamento, conclusão e reconciliação de obrigações persistidas ficam permitidos. Histórico nunca é removido.

## Pagamento

Manual (dinheiro, cartão presencial, Pix conferido): OWNER/ADMIN/MANAGER/CASHIER registra referência da evidência e valor exato, estado MANUAL_RECORDED separado de PSP. Não é prova bancária nem transação automática. Pix opcional usa resolver multibanco T04 por tenant/credencial real configurada, requer PAYMENTS no plano, flag dedicada ATENDEVENDE_RETAIL_PAYMENT_LIVE_ENABLED + T08.3. Claim CREATING persistido antes da chamada, referência e valor exatos; resposta de criação não confirma, GET verifica. Timeout -> REVIEW_REQUIRED, nunca reemitir cegamente. Claim expirado pode ser encaminhado a revisão por admin; recuperação de ID PSP perdido exige admin e GET verificável. Pagamento após cancelamento não reativa ordem; estorno comprovado via consulta, revisão humana, sem executar estorno automático.

## Plano e relatório

Usa a coleção subscriptions existente (não concede assinatura por onboarding). Todos os planos têm MULTISECTOR_OPERATIONS; online Pix requer PAYMENTS (STANDARD/PRO/PREMIUM). Período válido, status ACTIVE, código e tenant. Unidade onboarding T12 sujeita ao plano em scheduling, resolução de capabilities e varejo; unidades históricas T01–T11 preservam certificação interna e política anterior. Recebimento manual não é cobrança PSP. Regras comerciais/limites dos demais recursos continuam definidos na assinatura existente.

Relatório ADMIN/OWNER com janela civil IANA dia/semana/mês. Coortes de pedidos criados e reservas cujo início está no intervalo, estado atual, não reconstrução de fluxo de caixa histórico. Alimentação: valores de ordens confirmadas; varejo: concluídas, PSP verificado e manual separados; serviços: atendimentos, faltas e valor de serviço precificado, não recebimentos (preço ausente explicitado). Nenhuma soma especulativa cross-domain, nenhuma informação de cliente no agregado. Limite 1000 por fonte, fail closed se exceder; solicitar intervalo menor. Externos não cobertos. T05 financeiro permanece autoridade de recebimentos de alimentação.

Grounding T02 lê preços do catálogo de varejo ou agenda de serviços autorizado, com evidência de versão e sem usar catálogo alimentar para outro setor. Disponibilidade/preço não equivalem a confirmação nem habilitam execução autônoma. Operações são rotas de operador autorizado, não novas permissões de LLM.

## Deploy e gates

API /api/onboarding/units/:unitId/templates, GET/POST unidade, GET /report; /api/retail/units/:unitId/catalog, inventory, orders e comandos; painel central de capabilities oferece todos os modelos, catálogo, carrinho, estoque, caixa, pedidos e relatórios. Mesclar regras server-only de deploy/t10-scheduling.firestore.rules e índice composto deploy/t12-multisector.firestore-indexes.json com regras/índices oficiais sem sobrescrever terceiros. Nenhuma credencial, dado real, deploy ou homologação executada. Pendências externas: assinatura comercial, autorização de cada estabelecimento, integração/credenciais/PSP/Meta real e go-live separado.

## Certificação

Testes t12Multisector.test.ts (lifecycle, HTTP, planos, grounding, todos os modelos e modos); t12FirestoreEmulator.test.ts (onboarding transacional, race estoque, isolamento real, grants, cross-pack scheduling/relatório e privacidade); regressão T01–T11 em CI integral. Fechamento exige CI SUCCESS HEAD e pós-merge, documentação e aprovação do Diretor. Autorização de engenharia não equivale a aprovação de go-live.
