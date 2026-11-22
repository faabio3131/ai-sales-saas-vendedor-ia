# T08.3 — Engenharia de staging, recuperação e isolamento (NO_GO externo)

**Dependência:** T08.2 PR #22 integrada à main no SHA `75b3411858298ebf496c52766e35966a0bcf7c55`.  
**Escopo:** infraestrutura reproduzível, deploy de engenharia isolado, backup/restore drill, feature flags fail-closed, rollback, certificação CI.  
**Limite:** NÃO publica em Cloud Run/Contabo, NÃO muda proxy, NÃO conecta credenciais, NÃO homologa pagamentos/WhatsApp, NÃO libera a Pizzaria Americana.

## Topologia e fronteira

Há referências históricas a backend Google Cloud Run e a workers Contabo. **Nenhuma migração pode ser presumida**. O T08.3 cria apenas um stack Docker Compose isolado para ensaio e uma CLI local; deploy real requer inventário de infraestrutura, autorização e janela operacional. A API/worker devem ter a mesma imagem OCI certificada pelo digest em qualquer implantação posterior. Os workers e PSP ficam desligados neste compose; suas overlays existentes não são ativadas. O caminho legado `ChannelService` não possui escopo de unidade autenticado e, portanto, não pode enviar WhatsApp real: apenas o `WhatsAppDeliveryService` vinculado a tenant+unidade pode fazê-lo. O estado local `.t08-3/` é ignorado pelo Git.

`deploy/t08-3-staging.compose.yaml` publica somente `127.0.0.1` e fixa três controles: LIVE_ENABLED=false, GO_LIVE_APPROVED=false e ALLOWED_UNITS={}. Sem mudança no proxy, tráfego público é zero. A CLI não altera DNS, proxy, Firestore, Cloud Run, nem flags no runtime de terceiros.

## Flags de operação real (ponto de enforcement no serviço)

Em ambientes diferentes de `NODE_ENV=test`, criar cobrança online e enviar WhatsApp requerem ao mesmo tempo: `ATENDEVENDE_PILOT_LIVE_ENABLED=true`, `ATENDEVENDE_PILOT_GO_LIVE_APPROVED=true` e uma allowlist JSON com tenant/unidade/funcionalidade EXATOS em `ATENDEVENDE_PILOT_ALLOWED_UNITS`, por exemplo `{"tenant-exemplo":{"unidade-exemplo":["ONLINE_PAYMENT_CREATE","WHATSAPP_OUTBOUND"]}}`. O exemplo não confere autorização. Qualquer ausência, ambiguidade, JSON malformado ou outro tenant/unidade resulta em `PILOT_FEATURE_DISABLED`. Flag em ambiente NÃO é, sozinha, evidência de aprovação humana: operador deve registrar aceite T08.5 antes de alterar variáveis em ambiente real. Controles de RBAC, PSP, janela 24h, assinaturas e isolamento existentes são cumulativos, não substituídos.

## CLI de engenharia e recuperação

A partir da raiz do repositório:

```bash
python3 scripts/t08_3_ops.py deploy --project av-staging-isolated --image registry.example.test/atendevende@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
python3 scripts/t08_3_ops.py backup --project av-staging-isolated --uri gs://bucket-staging/backups/2026-11-21
python3 scripts/t08_3_ops.py restore --project av-staging-restore --source-project av-staging-isolated --restore-confirm --uri gs://bucket-staging/backups/2026-11-21
python3 scripts/t08_3_ops.py rollback --project av-staging-isolated
```

Todos acima são **dry-run por padrão**. Para execução de staging exigem `--execute --confirm-staging`. Deploy ainda exige `SESSION_SECRET` seguro fornecido fora do Git, imagem por digest e projeto cujo ID contenha 'staging' e não 'prod'. A CLI valida `docker compose config`, sobe staging sem build e exige health + `tenantIsolationEnforced` antes de atualizar estado local (0600). Se o novo container falha após uma versão previamente sadia, tenta restaurar a versão antiga e mantém o estado anterior; **não promete zero downtime**. Rollback reimplanta a imagem anterior no mesmo projeto staging. Não faz rollback dos dados.

Backup usa `gcloud firestore export` e espera a conclusão da operação remota antes de gravar a evidência. Restore usa `gcloud firestore import` **somente num projeto staging distinto do projeto origem**, e espera confirmação de conclusão. É essencial separar bucket, permissões, contas de serviço, retenção e auditoria. Execute restore apenas em staging descartável e valide conteúdo, contagens, chaves/índices, isolamento tenant/unidade e RPO/RTO. Firestore import não é rollback de escrita em produção.

## Gates de certificação

1. `npm run build`, `npm run typecheck`, `npm test`, testes Python cognitivos.
2. `python3 -m unittest discover -s scripts -p test_t08_3_ops.py -v`.
3. `docker compose -f deploy/t08-3-staging.compose.yaml config --quiet` com valores somente de CI; teste de smoke da imagem local em loopback sem contatos externos.
4. Testar kill switch/allowlist por tenant, feature e unidade; backup/import mockado; rollback exitoso e falha de health; não expor segredos em logs.
5. Após PR/CI do HEAD verde e merge/CI pós-merge, concluir **apenas engenharia interna T08.3**; T08.4 destrava para simulação das 10 jornadas. Deploy real, prova externa, restaurar dados reais e T08.5 continuam NO_GO.

**Limite da evidência:** teste unitário do orquestrador não prova um backup remoto existente, RTO/RPO real, restore real, acesso Contabo/Cloud Run ou homologação da pizzaria. Registrar os itens como externos até demonstração separada.

## Reconciliador legado — proteção de expansão do Compose

A revisão de CI detectou interpolação acidental das variáveis locais `legacy_failed` e `order_failed` do shell no `deploy/payment-reconciler.compose.yaml`. A sintaxe correta no arquivo Compose é `$$legacy_failed` e `$$order_failed`, para preservar as variáveis até a execução do script dentro do contêiner. O gate de configuração valida a preservação de ambas; sem isso o supervisor pode interpretar falsamente o resultado dos workers. O ajuste não ativa o reconciliador nem acessa bancos reais.
