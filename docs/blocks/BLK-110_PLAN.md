# BLK-110 — Sales Recovery — Plano de Execução

**Status:** AUTORIZADO PELO DIRETOR em 2026-08-28.

## Objetivo
Detectar oportunidades comerciais recuperáveis e registrar estratégias de recuperação governadas por políticas, sem disparar mensagens nem integrar canais neste bloco.

## Escopo
- `RecoveryCandidate` e `RecoveryAction` tenant-scoped;
- detecção determinística de oportunidades abandonadas/recuperáveis;
- evidências e motivo de recuperação;
- estratégia proposta e decisão do Policy Engine;
- prevenção de candidato duplicado ativo para a mesma oportunidade;
- endpoints protegidos para listar, detectar e preparar ação;
- Repository Interfaces + adapter Firestore;
- testes de isolamento, política, deduplicação e validação;
- runtime/CI em BLK-110.

## Fora de escopo
- envio WhatsApp ou qualquer canal;
- automação real de recuperação;
- descontos/preços gerados por IA;
- carrinho/checkout recovery sem integração correspondente;
- Revenue Attribution final;
- UI dedicada.

## Critério de saída
Build, typecheck, testes e runtime security boundaries verdes; nenhuma ação externa executada; fechamento documental após validação real.