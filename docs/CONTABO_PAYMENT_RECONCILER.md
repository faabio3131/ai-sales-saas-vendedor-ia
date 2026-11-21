# Deploy controlado — reconciliador de pagamentos no Docker/Contabo

## Preparação (não ativar sem credenciais e titulares verificados)
- Gerar e conferir o digest da imagem certificada que contenha `dist/payment-reconciler.cjs`; definir `ATENDEVENDE_IMAGE` para essa imagem imutável.
- Definir `FIREBASE_PROJECT_ID`, `PAYMENT_FIREBASE_CREDENTIAL_FILE` e `PAYMENT_BANK_SECRET_DIR` no ambiente do operador. **Não registrar valores secretos em arquivos versionados.**
- A conta de serviço deve ter apenas permissões mínimas necessárias ao Firestore. O diretório de banco deve possuir arquivos montados somente leitura com permissões `0600`, segregados por hash do tenant/provedor.
- Proteger a implantação e o servidor com controle de acesso, logs restritos, backups e alertas de indisponibilidade.
- Subir serviço isolado: `docker compose -f deploy/payment-reconciler.compose.yaml up -d`.
- Validar a execução a cada cinco minutos nos logs. Falhas de PSP produzem retentativa na próxima rodada; locks de 2 minutos e backoff previnem múltiplos workers processando o mesmo pagamento.
- Garantir que a aplicação principal e o worker estejam na **mesma versão certificada** e apontem para o mesmo Firestore, sem confundir ambientes.

## Evidência de homologação a coletar
Provedor/tenant/conta de recebimento, teste de criação de cobrança, notificação assinada, consulta oficial, reconciliação do valor, reentrega duplicada, falha de banco, recuperação pós-falha, ativação e rollback.

## Advertências
Este Compose é uma preparação implantável e **não significa que foi executado no host Contabo**. Falta configurar no proxy as validações mTLS específicas de Efí, Inter e Banco do Brasil e cadastrar os webhooks nos sistemas bancários. A produção continua bloqueada até que os testes reais comprovem os fluxos.
