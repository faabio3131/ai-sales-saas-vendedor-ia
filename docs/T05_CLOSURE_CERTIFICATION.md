# T05 — CERTIFICAÇÃO INTERNA — Gestão Financeira Comercial e Consultas Administrativas

**Data:** 21/11/2026 | **Governança:** T05 autorizada após T04; T06 permanece bloqueada.
**Resultado:** engenharia interna T05 certificada no SHA funcional abaixo, condicionada à integração e posterior certificação na main.

## Evidências funcionais
- PR #15: https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/15
- SHA funcional certificado: 49dcae65424c2f579cc650803e6b88aff1c34f9b
- CI cumulativa #44940142925 — SUCCESS: https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44940142925
- **289/289 testes TypeScript em 52 arquivos, 7/7 Python**, build Vite/esbuild, typecheck, runtime security boundaries, validação do reconciliador, Docker Node + Python — todos aprovados.
- Docker Node executou 288 PASS e 1 SKIP dependente de serviço externo; a matriz principal executou a prova HTTP S2S Python.
- CI pré-merge não substitui CI no commit real da main. Homologação de banco/ambiente não é demonstrada por doubles.

## Engenharia T05 concluída
1. Motor determinístico e reconstruível do ledger comercial: Orders T03 confirmados + outbox transacional T04, independente da entrega assíncrona ao evento derivado.
2. Reconciliador valida escopo tenant/unidade, unicidade de pedidos/pagamentos, sequência integral de versões, ordem temporal, compatibilidade de valor/itens, confirmação do cliente, evidência PSP_GET e recibos presenciais OPERATOR_COD. Falha fecha o relatório, nunca omite conflito.
3. Definições monetárias congeladas (BRL em centavos): vendas brutas, desconto, vendas líquidas após desconto, quantidade de pedidos, ticket médio, recebimentos confirmados, estornos, recebimentos após estornos, pendentes e ranking por quantidade; filtros dia/semana/mês.
4. Timezone IANA efetivo da unidade; intervalos semiabertos e conversão de meia-noite que suporta DST de 23/25h; semana configurável com versionamento CAS e auditoria de autor.
5. Consultas de grandes históricos paginadas no Firestore (500 documentos por página), até limite seguro de 100.000 pedidos ou eventos, com erro claro para não retornar somas truncadas. Sequenciamento verificado em processamento agrupado linear.
6. API /api/finance protegida por sessão e membership ativa; RBAC OWNER/ADMIN; nenhuma consulta por papéis de atendimento, operador/caixa ou canal público. Multi-tenant com filtragem por empresa/unidade e teste HTTP de autorização.
7. Painel administrativo responsivo dentro do workspace com KPIs, ranking, seletor de período e unidade, preferência do começo da semana, tratamento de indisponibilidade e pergunta em linguagem natural. Limpeza e fencing de respostas ao trocar de tenant/unidade/período.
8. Perguntas em português devolvem respostas geradas pelo **ledger determinístico**; AI opcional classifica apenas enum permitido, sem receber transações, extratos ou números do banco. Redaction de PII e credenciais, bloqueio de prompt injection e perguntas sobre dados não verificáveis.
9. **Taxas PSP sem feed de comprovantes:** processamentoFees=null, valores líquidos após tarifas=null; nunca estimar margem. Custos e tokens de IA da FM Tecnologia não são adicionados como despesas do estabelecimento.
10. Cobertura exibida e registrada: T03/T04 Orders com unitId canônico. Cobranças legadas por Quote sem unitId não são somadas arbitrariamente à unidade. Não declarar relatório como total histórico consolidado de todos os produtos.

## DoD T05
- [x] Totais conciliados com 100% dos pedidos e eventos **conhecidos no escopo T03/T04 por unidade**, cobrindo dia, semana e mês, estornos em outro período, DST, snapshots de linhas, falhas e duplicidades em testes internos.
- [x] Consultas financeiras rejeitadas sem OWNER/ADMIN e tenant membership; sem exposição via conversa pública, inclusive testes HTTP.
- [x] Separação explícita da receita comercial do tenant, das tarifas PSP sem comprovante (null) e do FinOps de IA da FM; nenhuma métrica inventada pela IA.

## Limitações de homologação/infraestrutura — NÃO certificadas nesta tarefa
- Nenhuma consulta à base Firestore real ou prova de índices aplicados na instância; manifesto deploy/t05-finance.firestore-indexes.json versionado, mas não publicado.
- Nenhum deploy Cloud Run/Contabo ou abertura de novos acessos comerciais/financeiros de clientes.
- Sem PSP real/homologação de fee statement e sem atribuição segura de unidade aos pagamentos legados. A visão do painel delimita a cobertura.
- Sem benchmark de 100.000 documentos reais, nem reprocessamento operacional de histórico legado. Capacidade maior exige projeção incremental aprovada e não está falsamente homologada.
- A verificação de idempotência, histórico e conciliação é determinística com doubles; o piloto real e fontes de verdade externas permanecem sujeitos à T08.
- T06 só poderá ser iniciada após autorização humana separada.

## Documentos de referência
- docs/ADR-006_T05_FINANCE_LEDGER_COGNITIVE_ADMIN.md
- docs/T05_FINANCIAL_ADMIN_RUNBOOK.md
- docs/CRONOGRAMA_MESTRE_ATENDEVENDEIA_COM_TRAVA.md
- deploy/t05-finance.firestore-indexes.json

**CI pós-merge:** preencher pela verificação independente do SHA final da main. Não interpretar este registro pré-merge como promoção operacional.
