# BLK-070 — AI Foundation — Plano de Execução

**Status:** AUTORIZADO PELO DIRETOR em 2026-08-28.

## Objetivo único
Implementar a fundação universal de IA do Vendedor IA sem acoplar domínio ou aplicação a SDK/provedor específico.

## Escopo autorizado
- contratos `AIRequest`, `AIResponse`, `AIProviderInterface` e `AIRouterInterface`;
- capabilities canônicas;
- router provider-neutral com seleção por capability;
- validação obrigatória de `tenantId`;
- resposta e erros normalizados;
- primeiro adapter aprovado como adapter estrutural/testável, sem credencial real hardcoded;
- testes de contrato, roteamento, isolamento de provider e sanitização;
- atualização do runtime marker e CI para BLK-070.

## Primeiro adapter
Gemini permanece o primeiro adapter planejado da V1, encapsulado exclusivamente atrás de `AIProviderInterface`. O BLK-070 não exige chamada live nem credencial real para validar a arquitetura. Integração live será registrada separadamente quando credenciais/configuração externa estiverem disponíveis.

## Fora de escopo
- Lead Intelligence (BLK-080);
- Sales Engine/Policy Engine (BLK-090);
- envio automático de mensagens;
- ferramentas/agentes autônomos;
- persistência de ações de IA;
- billing/cálculo financeiro;
- fallback multimodelo avançado;
- credenciais reais no repositório.

## Gates
Architecture, Tenant, Security, Test, Documentation e Git obrigatórios.

## Critério de saída
Build + typecheck + testes + runtime security boundaries verdes; contratos universais implementados; aplicação não chama adapter concreto diretamente; nenhum secret real versionado; relatório/closure somente após validação real do CI.
