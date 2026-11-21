# T02 — CERTIFICAÇÃO INTERNA — BUSINESS KNOWLEDGE & MEMORY

**Data:** 21/11/2026 • **Cronograma:** T02 do Cronograma Mestre com Trava v1.1
**Estado:** todos os critérios de engenharia interna T02 validados na CI funcional da PR #12.
**Escopo:** somente T02. T03 permanece bloqueada para nova autorização.

## Evidência principal
- PR consolidada: [#12](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/pull/12).
- Commit funcional certificado (antes do registro documental): `5a89a5580ede7e3c45041008808deebf692691d7`.
- CI cumulativa: [#44917033763 — SUCCESS](https://github.com/faabio3131/ai-sales-saas-vendedor-ia/actions/runs/44917033763).
- Resultado: **226/226 testes TypeScript**, **45/45 arquivos**, **7/7 testes Python**, build/typecheck, runtime-security, gate de reconciliação, Docker Node e Docker cognitivo Python não-root — todos aprovados.
- No smoke Docker Node existe **1 teste dependente de serviço externo ignorado**, enquanto o teste HTTP real do Python S2S é executado e aprovado separadamente no mesmo workflow de CI.
- CI pós-merge da main precisa ser verificada sob o SHA final; validação interna não é deploy/homologação real.

## Capacidade entregue
1. `BusinessCapabilityRegistry` universal com vertical, capabilities e modo operacional por tenant/unidade; modos `NATIVE_OPERATIONS` / `INTEGRATED_OPERATIONS` não ativam automaticamente PDV/KDS.
2. Identidade configurável do atendente (nome, estilo) e `PolicyProfile` com timezone, idioma, retenção e negativa padrão da memória.
3. `BusinessKnowledge` com revisões de versão imutável, período de vigência, autoria administrativa, `expectedVersion` e publicação transacional Firestore.
4. Grounding determinístico de perguntas e preços do catálogo do tenant; `UNKNOWN` sem fonte, `CONFLICT` diante de ambiguidade; nenhum preço inferido a partir do texto da IA.
5. ContextPack com evidências autorizadas e escopo tenant/unidade, integrado ao contrato T01.
6. Memória privada por tenant/unidade/cliente com consentimento explícito em mensagem inbound registrada, fontes verificadas, retenção configurável, revogação e remoção.
7. Contexto cognitivo mantém memória do cliente como **input não confiável**, não a promove a `trustedFacts`.
8. Worker de limpeza física `purge:business-memory` com lotes limitados, transações e saída operacional sem PII.
9. API autenticada e tenant-scoped, gerenciamento restrito a `OWNER`/`ADMIN`; RBAC real de unidade ainda depende de modelo de membership por unidade aprovado em fase posterior.
10. Documentação de execução e ADR, sem novos provedores, credenciais reais ou migração forçada de dados.

## Critérios DoD T02
- [x] Dois tenants com catálogos, preços e regras distintos; proibição de vazamento entre tenants comprovada por testes.
- [x] Respostas ancoradas em fatos aprovados e catálogo ativo; sem invenção de preços/horários; ambiguidades e ausência de fonte negam afirmação.
- [x] Versionamento, vigência, memória persistível em Firestore e governança por consentimento/retention/revocation; repositório Firestore implementado e contrato testado com doubles determinísticos, **não** homologado em uma instância externa.
- [x] BusinessCapabilityRegistry e modo operacional persistíveis por tenant/unidade, com versão, transação e autorização; sem nicho fixo no núcleo.

## Sem alegações indevidas
- Não houve publicação Contabo, conectividade real com Firestore do cliente, credenciais reais, homologação WhatsApp, configuração efetiva da Pizzaria Americana ou teste com dados reais.
- A coleção legada `customerMemories` da etapa anterior não é utilizada como fonte do Core cognitivo T02 nem migrada automaticamente; tratamento dos históricos anteriores exige avaliação separada de retenção e consentimento.
- O catálogo atual isola tenants, mas ainda é global por tenant. Associação por unidade e variantes alimentares são trabalho explícito da T03, não devem ser classificados como já concluídos.
- O verificador de consentimento depende da confiabilidade das mensagens persistidas; validação de identidade real do canal WhatsApp/WebChat deve ocorrer na T08.
- Limpeza física agendada precisa ser ligada na infraestrutura externa do piloto; o comando interno está implementado.
- T03 permanece travada pela autorização humana de avanço, conforme Cronograma Mestre.
