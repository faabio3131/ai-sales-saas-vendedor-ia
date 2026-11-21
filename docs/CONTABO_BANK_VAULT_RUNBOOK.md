# Cofre de credenciais para Contabo (sem segredos no Git)

Backend de cofre 1: GCP Secret Manager via identidade de execução; credencialRef no padrão projects/.../secrets/.../versions/latest.
Backend de cofre 2: PAYMENT_VAULT_BACKEND=MOUNTED em Docker/Contabo, com arquivos em PAYMENT_SECRET_MOUNT_DIR (padrão /run/secrets/atendevende-payments).
Cada conexão registra credentialRef igual a mounted:<sha256(tenantId + NUL + providerId)>; arquivo correspondente <hash>.json com permissão 0600, sem symlink e volume somente leitura.
O JSON deve conter tenantId, providerId, recipientId e segredos específicos do banco. Nada disso deve ir para Firestore, API pública, PR ou chat.
Ativação requer verificação humana de titularidade da conta e correspondência exata do recebedor. Rotação de segredo precisa de procedimento de instalação atômica, auditoria e nova validação do operador.
Ambos os mecanismos são implementações de engenharia; nenhum acesso Contabo ou homologação de conta bancária está declarado por este documento.