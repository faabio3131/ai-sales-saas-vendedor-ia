# SYSTEM DESIGN — REGRAS OBRIGATÓRIAS PARA IAs E CONSTRUÇÃO

**Status:** operacional e obrigatório.

## Autoridade documental
Antes de executar qualquer bloco, a IA deve ler na ordem: Documento Mestre → Arquitetura Oficial → System Design → Requisitos → Contratos → Modelo de Dados → Plano de Implementação → tarefa atual → critérios de aceite/testes.

Arquitetura e documentos aprovados são autoridade. O executor é colaborador técnico, não dono do produto.

## Proibições sem aprovação explícita
- mudar stack, banco, framework ou provedor principal;
- alterar limites entre módulos;
- remover interfaces/adapters;
- expandir o produto para ERP;
- inserir SDK/provedor externo diretamente no domínio;
- alterar multitenancy, segurança ou governança;
- remover testes;
- reescrever módulos estáveis sem causa;
- introduzir complexidade distribuída desnecessária;
- inventar requisitos, entidades, endpoints, campos ou comportamentos.

## Sequência de construção
`Foundation → Authentication → Tenancy → Customers → Products/Services → Conversations → AI Provider Layer → Leads/Opportunities → Sales Engine → Follow-up → Recovery → Channels → Quotes → Payments → Revenue Attribution → Plans/Billing`

## Ciclo obrigatório por bloco
`PLAN → IMPLEMENT → TEST → REVIEW → FIX → VALIDATE → COMMIT → NEXT`

A promoção ao próximo bloco depende de critérios de saída objetivos e aprovação.

## Análise pré-implementação
Antes de alterar código, o executor deve informar:
1. objetivo único;
2. arquivos/áreas afetados;
3. contratos envolvidos;
4. dependências necessárias;
5. riscos e impacto em tenant/security;
6. testes que serão criados/executados;
7. itens explicitamente fora de escopo.

## Portabilidade por interfaces
Obrigatório preservar abstrações de:
- AI Provider;
- Payment Provider;
- Channel Provider;
- Persistence/Repositories.

O domínio não conhece SDKs externos.

## Segurança estrutural
- `tenantId` validado em toda operação de negócio;
- secrets somente server-side;
- autorização além de autenticação;
- validação de entradas e saídas estruturadas de IA;
- webhooks validados e idempotentes;
- erros externos sanitizados;
- ações críticas auditáveis.

## Autonomia governada
O agente comercial só executa ações permitidas por políticas do tenant e pelo FeatureEntitlementService. A IA não cria permissões nem limites comerciais.

## Gate de escopo
Uma nova capacidade só entra quando claramente melhora receita, conversão, recuperação, retenção ou economia comercial relevante, mantendo simplicidade e escalabilidade.

## Google AI Studio
O Build Agent deve tratar `/docs` como contexto operacional obrigatório. Se uma ordem conflitar com estes documentos, deve parar e reportar. Sugestões não viram implementação sem aprovação.

## ADR
Mudanças arquiteturais relevantes exigem ADR antes da implementação, com contexto, opções, decisão, consequências e aprovação.

## Definition of Done
Um bloco só está concluído quando:
- escopo autorizado implementado;
- build válido;
- testes pertinentes passando;
- isolamento tenant/security preservados;
- documentação atualizada quando necessário;
- nenhuma mudança fora de escopo escondida;
- limitações e pendências reportadas;
- estado versionável no Git.

## Regra de verdade
Nunca converter planejamento em alegação de implementação. Evidência de build/teste deve acompanhar qualquer afirmação de sucesso.
