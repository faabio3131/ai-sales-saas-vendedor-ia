# BLK-200 — Commercial Release — Plano

**Status:** AUTORIZADO PARA IMPLEMENTAÇÃO

## Objetivo
Criar o gate técnico e operacional de release comercial do Vendedor IA, sem declarar lançamento real enquanto requisitos externos e piloto real não estiverem comprovados.

## Escopo
- release readiness server-side com status `GO` / `NO_GO`;
- exigência explícita de piloto real validado antes de lançamento;
- verificação estrutural de ambiente real, autenticação/persistência, IA, WhatsApp, billing comercial, monitoramento e documentos legais;
- endpoint protegido e tenant-scoped de readiness;
- checklist/runbook de rollout, rollback e pós-release;
- atualização do runtime marker para BLK-200;
- testes e CI de regressão.

## Regras de verdade
- `BLK-200` implementado não significa produto comercialmente lançado;
- ausência de evidência de piloto real deve produzir `NO_GO`;
- nenhuma credencial é retornada pela API;
- flags de readiness representam evidência operacional fornecida pelo ambiente, não substituem validação humana/documental;
- release comercial exige aprovação humana final.

## Fora de escopo
- inventar clientes/pilotos executados;
- criar contas ou credenciais externas;
- publicar infraestrutura sem ambiente/projeto explicitamente autorizado;
- cobrar clientes reais automaticamente;
- declarar disponibilidade pública sem evidência externa.

## Gates
Architecture, Tenant, Security, Test, Documentation e Git permanecem obrigatórios.
