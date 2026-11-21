# T08.1 — Certificação de engenharia e pendências de validação real

**Data de preparação:** 21/11/2026.  
**Classificação:** **ENGENHARIA INTERNA T08.1 CERTIFICADA**; **NÃO é aceite real da proprietária** e **não autoriza T08.2**.

## Contratos construídos
- Pré-cadastro extraído de fonte fornecida pelo usuário: 58 sabores com ingredientes, cinco combos com preços impressos (não homologados), número 61 preservado, nº 146 e dois telefones (segundo não confirmado).
- Endereço pesquisado em 21/11/2026: Cajamar/SP confirmado pelo Diretor, **Avenida das Juritis — Paraíso (Polvilho) — CEP 07793-530** em [documento municipal](https://cajamar.sp.gov.br/concursos/wp-content/uploads/sites/7/indepac_cajamar-edital-cp-05-2023_28_12_23.pdf). App de [outra pizzaria](https://play.google.com/store/apps/details?hl=pt&id=com.wabiz.delivery.laitalia) informa nº 146; proprietário precisa validar marca e ocupação antes do gate.
- Cadastro tenant/unidade imutável por revisão com transações Firestore CAS, estado DRAFT e somente aceites reais OWNER_ATTESTED.
- Painel interativo de cadastro e aprovação exclusivo OWNER, não exposto como funcionalidade operacional para funcionários, com modo explicitamente escolhido.
- Validação de cardápio T03 (inclui 58 sabores por pizza), alinhamento de preços/taxas/horários/perfis/CEP, decisões por modo e evidência de versão.
- Readiness do piloto fechado por T08.1, T08.3, T08.4 e T08.5.
- Segurança multi-tenant, reprovação de dados incompletos, alteração de revisão, falso preço, permissão não autorizada, tentativa de injetar estado READY/OWNER_ATTESTED, mismatch de origem e seleção automática de modo.
- Nenhum cadastro real persistido sem tenant/membership comprovados, nem promoção/PSP/canal externo ativado.

## Critério de entrada do aceite real
- [ ] Identidade real do tenant e da unidade informada e verificada.
- [ ] Pessoa autorizada da pizzaria autenticada com membership OWNER efetiva.
- [ ] Confirmação real do endereço completo (bairro, município, CEP) e telefones.
- [ ] Confirmação real do nome da assistente, abertura por dia e responsáveis.
- [ ] Cardápio completo com todos os preços vigentes, sabores, combos, pizzas meio a meio, alergênicos e promoções conferidas e publicado em catálogo T03.
- [ ] Áreas e taxas de entrega e janelas de tempo confirmadas.
- [ ] Preferências de pagamento e perfis operacionais aceitos.
- [ ] Escolha exclusiva de NATIVE_OPERATIONS ou INTEGRATED_OPERATIONS assinada pela proprietária para o tenant/unidade corretos.
- [ ] Registro de aceite com hash de dados, catálogo, perfil e referência documental.
- [ ] Relatório de prontidão T08.1 OWNER_ATTESTED, ainda sem habilitar produção real.

## Evidências de CI
- **PR #19:** https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/19
- **SHA funcional certificado:** `8311a1ce54a2d64c34f7efdb7575af033cc2129c`.
- **CI integral do SHA:** [#44960106738 — SUCCESS](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44960106738).
- **Testes TypeScript:** 350 PASS em 59 arquivos no runner Node, zero falhas.
- **Testes Python:** 7 PASS, zero falhas.
- **Smoke Docker:** 349 testes TypeScript PASS, 1 SKIP por ambiente, zero falhas.
- **Demais gates:** typecheck, build Vite/esbuild, isolamento de API e autenticação HTTP 401, configuração do worker reconciliador, Docker API e Docker cognitivo aprovados.
- **Certificação acumulada:** T01–T07 preservada, novo fluxo T08.1 validado; validação real da proprietária não está incluída no escopo desta CI.

**Bloqueio externo, não de engenharia:** nenhum item da lista de aceite real acima pode ser marcado como realizado só porque existiu pré-cadastro ou teste em CI. A engenharia foi certificada, mas o fechamento do gate T08.1 e o início da T08.2 dependem de evidência externa da proprietária. A seleção de modo na interface é intenção, não acionamento do sistema nativo ou PDV.

**Documentação de operação:** docs/T08_1_OWNER_VALIDATION_RUNBOOK.md.
