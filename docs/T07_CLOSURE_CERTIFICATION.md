# T07 — Certificação da autonomia operacional governada

**Escopo:** implementação e E2E simulados internos pós-T06. **Estado no preparo documental:** CANDIDATA EM CERTIFICAÇÃO; nenhuma homologação de canal, PSP ou produção real.

## Evidências previstas
- Branch: `feat/t07-governed-autonomy`; PR #18 (Draft até conclusão da CI).
- Endpoints autenticados: `/api/autonomy/units/:unitId/*`.
- Políticas versionadas por empresa/unidade e default `ASSIST` / allowlist vazia.
- Aprovações OWNER/ADMIN delimitadas por usuário, hash da solicitação, valor, validade, versão de política e execução única.
- Recibos Firestore transacionais e fencing de retry, inclusive falha ambígua de provedor.
- Delegação real para T03 pedidos, T04 pagamentos e T06 produção; nenhuma ferramenta para alterar modo operacional, status financeiro, desconto arbitrário ou acessar finanças sem RBAC.
- Confirmações WhatsApp dependem de origem assinada/associação a conversa+mensagem+cliente; sinais adversariais geram bloqueio.
- Recuperação comercial condicionada a opt-in/opt-out registrado em trust store, sem envio direto pelo gateway.
- Testes internos nativo/integrado, checkout/pagamento condicionado, multitenancy, aprovações e riscos, CI cumulativa.

## Limites explícitos
O `VerifiedCommercialChannelIngress` foi desenvolvido como contrato de ingestão privada, não conectado a um webhook externo ativo. Isso é obrigação da T08. Emissões Pix reais, provisionamento WhatsApp, índices/configuração no Firestore de produção, cadastro da Pizzaria Americana, deploy e piloto 10/10 reais não são certificados pela T07. Nenhuma prova de teste mock é prova de produção.

## Gate de fechamento
**PENDENTE:** registrar HEAD funcional, número exato de CI com SUCCESS, contagem de testes, cobertura, atualização do Cronograma Mestre e verificação da CI pós-merge. A T08 só pode destravar após este fechamento e aprovação de avanço humana.
