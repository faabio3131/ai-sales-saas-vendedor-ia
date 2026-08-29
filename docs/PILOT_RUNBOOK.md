# PILOT RUNBOOK — AI Sales SaaS / Vendedor IA

## Objetivo
Executar um piloto controlado com baixo risco, evidência verificável e possibilidade de rollback antes do release comercial.

## Go / No-Go obrigatório
Antes de habilitar uma empresa real:
1. CI da `main` verde;
2. ambiente HTTPS aprovado;
3. `SESSION_SECRET` forte e server-side;
4. Firebase/Auth e Firestore reais configurados e testados;
5. tenant e membership reais validados com teste de isolamento;
6. ao menos um provedor de IA real aprovado e testado por Universal AI Provider Interface;
7. WhatsApp real configurado e webhook validado se fizer parte do piloto;
8. pagamento real só entra se explicitamente incluído no piloto e após webhook/idempotência validados em ambiente real;
9. logs de erro sem segredos/PII desnecessária;
10. responsável humano definido para handoff e incidentes.

## Escopo recomendado do primeiro piloto
- 1 a 3 empresas;
- poucos usuários internos por empresa;
- WhatsApp + atendimento + CRM invisível + leads + follow-up + recovery;
- autonomia inicial `ASSIST` ou `COPILOT`;
- pagamentos reais inicialmente opcionais;
- período mínimo sugerido: 7 dias úteis antes de qualquer ampliação.

## Métricas mínimas
- mensagens recebidas/respondidas;
- leads criados;
- oportunidades geradas;
- follow-ups executados;
- recuperações iniciadas e concluídas;
- quotes criadas/aceitas;
- receita atribuída apenas a eventos financeiros confirmados;
- taxa de handoff humano;
- erros por integração;
- latência operacional percebida;
- incidentes de tenant/security: meta zero.

## Critérios de interrupção imediata
- qualquer vazamento entre tenants;
- autenticação/autorização contornada;
- segredo exposto;
- webhook não validado alterando estado financeiro;
- mensagem enviada ao destinatário errado;
- comportamento repetitivo/spam não governado;
- inconsistência financeira material.

## Evidência de fechamento do BLK-190
O bloco só pode ser declarado como PILOTO REAL VALIDADO quando houver evidência de ambiente real e empresa(s) piloto. Até lá, o software pode ser classificado apenas como `PILOT-READY` estruturalmente.
