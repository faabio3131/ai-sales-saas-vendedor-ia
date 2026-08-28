# BLK-100 — Follow-up — Plano de Execução

**Status:** AUTORIZADO PELO DIRETOR em 2026-08-28.

## Objetivo único
Implementar a fundação de follow-up agendado, consultas de itens vencidos, execução idempotente e trilha auditável por tenant.

## Escopo autorizado
- entidade `FollowUp` tenant-scoped;
- contrato `FollowUpRepository`;
- repository in-memory para testes e adapter Firestore;
- criação/listagem/consulta de follow-ups;
- consulta `due` por `scheduledAt` e status;
- execução idempotente por `idempotencyKey`;
- transições mínimas `SCHEDULED -> PROCESSING -> COMPLETED | RETRY | FAILED | CANCELLED`;
- registro de tentativa e timestamps de execução;
- API protegida por autenticação + TenantContext;
- testes de isolamento, due query, idempotência, validação e regressão;
- atualização do runtime marker e CI.

## Regras
- nenhum follow-up pode atravessar tenant;
- customer/opportunity/conversation IDs são referências, não autoridade;
- execução repetida com a mesma chave não pode gerar nova tentativa;
- envio real de WhatsApp/canal permanece fora do escopo até BLK-120;
- política/autonomia futura poderá governar envio, mas BLK-100 não envia mensagem externa.

## Fora de escopo
Sales Recovery (BLK-110), Channels/WhatsApp (BLK-120), workers distribuídos, scheduler externo, envio automático real e billing.

## Critério de saída
Build, typecheck, testes e runtime security boundaries verdes; fechamento documental somente após CI real bem-sucedido.
