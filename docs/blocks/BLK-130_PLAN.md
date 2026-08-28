# BLK-130 — Dashboard / Analytics — Plano de Execução

**Status:** AUTORIZADO PELO DIRETOR em 2026-08-28.

## Objetivo
Implementar o dashboard comercial inicial, tenant-scoped, com foco em “O que precisa da minha atenção hoje?” e métricas comerciais derivadas de dados reais já existentes no domínio.

## Escopo
- serviço de analytics sem dependência direta de provider externo;
- resumo de funil e valor estimado de pipeline;
- follow-ups vencidos/prioritários;
- oportunidades com próxima ação vencida;
- candidatos de recuperação abertos;
- contagens comerciais iniciais;
- endpoint protegido `/api/dashboard`;
- testes explícitos de tenant isolation e cálculos determinísticos;
- runtime/CI avançado para BLK-130.

## Fora de escopo
- BI avançado;
- RevenueEvent/Revenue Attribution completo (RF-101/RF-102 ficará para bloco específico de receita);
- gráficos complexos no frontend;
- data warehouse;
- integração externa de analytics.

## Gates
Architecture, Tenant, Security, Test, Documentation e Git obrigatórios.
