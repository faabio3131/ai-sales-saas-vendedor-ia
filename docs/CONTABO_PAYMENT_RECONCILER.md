# Deploy controlado — reconciliador de pagamentos Docker/Contabo

## Estado e topologia
A aplicação HTTP está documentada em `docs/ops/OP-030_PRODUCTION_DEPLOYMENT_HANDOFF.md`
como publicada no Google Cloud Run. Isso NÃO comprova a versão atualmente em execução.
O worker pode executar separadamente na Contabo, mas precisa usar **o mesmo projeto Firestore,
as mesmas conexões merchantPaymentConnections e o mesmo backend de cofre** da aplicação.
A implantação só é homologada depois de observar o ambiente real.

## Gate obrigatório — referências do cofre
- Referências `projects/.../secrets/.../versions/...`: usar o Compose principal, com
  `PAYMENT_VAULT_BACKEND=GOOGLE_SECRET_MANAGER`, e conceder acesso limitado à conta de
  serviço para cada segredo bancário necessário.
- Referências `mounted:<sha256>`: usar o Compose principal **e** o overlay MOUNTED; o
  backend HTTP também precisa usar MOUNTED para essas conexões. Nunca presumir que o
  worker MOUNTED consegue ler segredos do Secret Manager.
- A conexão ativa deve corresponder exatamente a `tenantId`, `providerId` e
  `recipientId`. Não armazenar valores de segredo no Firestore, no GitHub ou nos logs.
- NÃO converter referências automaticamente, copiar credenciais para outro cofre ou
  ativar um provedor sem aprovação do titular e validação da conta beneficiária.

## Pré-requisitos do operador
1. Escolher imagem imutável **certificada** que contenha
   `dist/payment-reconciler.cjs`. Definir `ATENDEVENDE_IMAGE` para digest dessa imagem
   e validar que o backend HTTP opera com código compatível.
2. Definir `FIREBASE_PROJECT_ID` do mesmo projeto do backend e
   `PAYMENT_FIREBASE_CREDENTIAL_FILE` apontando para um arquivo local restrito e
   exclusivamente gerido pelo operador; não versionar a credencial.
3. Conta de serviço com privilégio mínimo no Firestore e, para o cofre GCP, acesso
   somente aos segredos específicos dos tenants autorizados. Idealmente substituir
   chaves persistentes por federação de identidade quando viável.
4. Para MOUNTED, definir `PAYMENT_BANK_SECRET_DIR` como diretório raiz seguro com
   arquivos `0600` correspondentes às referências, montado `ro`; somente operar se
   as referências e o backend HTTP forem compatíveis.
5. Configurar backups, retenção de logs, monitoramento do estado de saúde do container,
   alertas e rollback para a imagem anterior.

## Verificação de configuração — sem transações
Na raiz da cópia versionada, usar variáveis de ambiente do operador (não do Git).
Para cofre GCP:

```bash
docker compose -f deploy/payment-reconciler.compose.yaml config --quiet
docker compose -f deploy/payment-reconciler.compose.yaml up -d
```

Para o cofre MOUNTED, **somente quando o backend usa a mesma modalidade**:

```bash
docker compose -f deploy/payment-reconciler.compose.yaml \
  -f deploy/payment-reconciler.mounted-vault.compose.yaml config --quiet
docker compose -f deploy/payment-reconciler.compose.yaml \
  -f deploy/payment-reconciler.mounted-vault.compose.yaml up -d
```

A execução de `config --quiet` é um pré-check estrutural, não conecta contas.
O serviço consulta periodicamente os pagamentos e registra
`payment_reconciliation_completed` em caso de rodada bem-sucedida.
Falhas registram `payment_reconciliation_cycle_failed` e o healthcheck fica
`unhealthy` se não ocorrer uma rodada bem-sucedida por mais de 20 minutos.
O intervalo de **5 minutos é o tempo de espera após a conclusão de cada rodada**;
não é um agendamento fixo de relógio.

O healthcheck **não reinicia automaticamente** o container nem dispara alertas.
Exige integração com monitor externo (alertar `unhealthy`, restart loop, ausência de
rodadas e erros persistentes). Não declarar produção pronta apenas por `healthy`.

## Gate externo e evidências
Para cada provedor/tenant: titularidade, criação de cobrança, callback autenticado,
consulta oficial ao PSP, conferência de valor e referência, reentrega idempotente,
falha simulada de comunicação, recuperação, conciliação da transação e rollback.
Efí, Inter e BB exigem borda mTLS que autentique os certificados oficiais e um
relay privado HMAC. Os callbacks reais não podem ser simulados como homologação.
Não enviar dados bancários reais, arquivos `0600` nem segredos ao chat.

## Situação de ativação
Este repositório contém **configuração implantável**, mas nenhuma execução na Contabo,
provisionamento de credenciais bancárias ou homologação externa foi certificada por
este documento.
