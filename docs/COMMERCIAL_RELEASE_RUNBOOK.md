# COMMERCIAL RELEASE RUNBOOK — AI SALES SAAS / VENDEDOR IA

## Estado
Este documento define o processo de lançamento comercial. Ele não prova que o lançamento aconteceu.

## Pré-condições obrigatórias
1. Piloto real concluído e validado por responsável humano.
2. Firebase/Auth/Firestore reais validados no ambiente de produção.
3. Pelo menos um provedor real de IA aprovado e testado.
4. WhatsApp real configurado e validado ponta a ponta.
5. Billing/pagamento comercial real configurado para planos pagos.
6. Monitoramento e alertas ativos.
7. Termos, privacidade e documentos comerciais aprovados.
8. URL pública de produção configurada.
9. Plano de rollback revisado e aprovado.
10. CI do commit de release completamente verde.

## Gate de release
Consultar `GET /api/release/readiness` em sessão autenticada e tenant autorizado. O relatório deve retornar `GO`, mas `GO` técnico ainda exige aprovação humana final.

## Rollout recomendado
- começar com lote pequeno de clientes;
- acompanhar autenticação, mensagens, filas de atendimento, erros de provedores, latência e faturamento;
- expandir gradualmente apenas após estabilidade observada;
- manter autonomia comercial inicialmente conservadora;
- preservar capacidade de handoff humano.

## Critérios de rollback
Rollback ou interrupção imediata diante de:
- falha de isolamento entre tenants;
- confirmação financeira incorreta;
- envio indevido ou duplicado relevante em canal real;
- vazamento de segredo ou informação privada;
- perda/corrupção relevante de dados;
- comportamento comercial autônomo fora das políticas;
- indisponibilidade persistente sem mitigação aceitável.

## Pós-release
- revisar erros e incidentes diariamente no início;
- acompanhar conversão, follow-up, recuperação e receita atribuída;
- registrar feedback de clientes;
- somente promover aumento de autonomia após evidência operacional e aprovação humana.

## Regra de verdade
Nenhum documento, flag ou CI isolado permite declarar “produto lançado comercialmente”. A declaração exige evidência operacional real e aprovação humana.
