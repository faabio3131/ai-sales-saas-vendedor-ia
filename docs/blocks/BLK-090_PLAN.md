# BLK-090 — Sales Engine — Plano de Execução

**Status:** AUTORIZADO PELO DIRETOR após BLK-080 verde.

## Objetivo único
Implementar o núcleo de decisão comercial e a próxima ação governada por Policy Engine, sem executar ações externas neste bloco.

## Escopo autorizado
- ações comerciais normalizadas `RESPOND`, `QUALIFY`, `FOLLOW_UP`, `CREATE_QUOTE`, `REQUEST_HUMAN`, `RECOVER`, `OFFER_UPSELL`, `OFFER_CROSS_SELL`, `CREATE_PAYMENT`, `NO_ACTION`;
- `SalesContext`, `SalesDecision`, `SalesEngineInterface`;
- `PolicyEngineInterface`, níveis `ASSIST | COPILOT | AUTONOMOUS` e decisão `allowed/requiresHumanApproval/reasonCode/effectiveLimits`;
- decisão determinística segura por estágio e sinais de lead;
- sugestão opcional via `AIRouterInterface`, validada antes de qualquer uso;
- Policy Engine obrigatório após decisão e antes de devolver ação executável;
- API protegida para solicitar decisão;
- testes de tenant isolation, autonomia, política, saída inválida de IA e fallback;
- runtime/CI BLK-090.

## Fora de escopo
- executar follow-up (BLK-100);
- recovery operacional (BLK-110);
- WhatsApp/envio de mensagens (BLK-120);
- criação real de quote/payment (BLK-140/150);
- upsell/cross-sell operacional (BLK-160);
- billing/entitlements (BLK-170).

## Regra crítica
BLK-090 decide e governa; não executa side effects externos. IA sugere, Policy Engine autoriza/bloqueia e a autoridade humana permanece superior.
