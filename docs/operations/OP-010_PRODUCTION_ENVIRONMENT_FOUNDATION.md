# OP-010 — Production Environment Foundation

**Status:** EM EXECUÇÃO

## Objetivo
Preparar a aplicação para ativação operacional real sem inserir segredos no repositório e sem declarar produção antes da validação externa.

## Escopo
- contrato explícito de variáveis de produção;
- validação server-side de configuração crítica;
- empacotamento container reproduzível;
- healthcheck operacional;
- documentação de deploy e rollback;
- testes de validação sem expor valores secretos.

## Fora de escopo
- criar ou alterar credenciais reais;
- provisionar projeto Firebase/Google Cloud;
- registrar número Meta/WhatsApp;
- contratar provedor de pagamento;
- declarar piloto ou release comercial reais.

## Gate
A fundação é considerada pronta quando build, typecheck e testes estiverem verdes e a imagem/contrato de ambiente puderem receber credenciais reais por secret manager externo.
