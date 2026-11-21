# T08.1 — Certificação de engenharia e pendências de validação real

**Data de preparação:** 21/11/2026.  
**Classificação:** implementação interna de cadastro e validação executada em branch; **NÃO é aceite real da proprietária** e **não autoriza T08.2**.

## Contratos construídos
- Pré-cadastro extraído de fonte fornecida pelo usuário: 58 sabores com ingredientes, cinco combos com valores impressos (não homologados), número 61 preservado, endereço parcial e dois telefones (segundo não confirmado).
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
- PR: pendente de CI e merge (a preencher após certificação)
- Baseline de testes do primeiro HEAD, antes do refinamento de vigência: [CI integral #44959737750](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44959737750) — SUCCESS.
- 349 testes TypeScript PASS em 59 arquivos no runner Node; 7 testes Python PASS.
- Smoke Docker: 348 TS PASS + 1 SKIP identificado por ambiente; sem falhas.
- Typecheck, build Vite/esbuild, fronteira de segurança HTTP, containers API e cognitivo aprovados.
- O HEAD final com validação de vigência de catálogo/perfil será certificado novamente antes do merge.

**Bloqueio externo, não de engenharia:** nenhum item da lista de aceite real acima pode ser marcado como realizado só porque existiu pré-cadastro ou teste em CI. A implementação pode ser integrada à main após testes aprovados, mas o fechamento do gate T08.1 e o início da T08.2 dependem de evidência externa da proprietária.

**Documentação de operação:** docs/T08_1_OWNER_VALIDATION_RUNBOOK.md.
