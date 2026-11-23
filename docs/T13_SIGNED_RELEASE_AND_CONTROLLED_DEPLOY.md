# T13 — Pipeline de release assinado e deploy governado

- Fluxo manual de seal em main: revisão independente no HEAD final, CI
  push pós-merge, protected environment com required reviewers, regras
  Firestore ativas, GHCR digest, cosign/Sigstore e provenance+SBOM atestados.
- Fluxo manual separado de produção: environment t13-production-approval,
  revalidação dos gates, validação de assinatura e GH attestation, SSH com
  known_hosts pinado, deploy de API e payment-reconciler no mesmo digest.
- Host pré-provisionado em /opt/atendevendeia, com Docker/Compose, cosign,
  Python, curl, credencial GHCR privada e arquivo .t13-runtime.env protegido.
- O host fornece FIREBASE_PROJECT_ID, PUBLIC_APP_URL,
  T13_SESSION_SECRET_FILE, PAYMENT_FIREBASE_CREDENTIAL_FILE e porta opcional.
  CI nunca copia esses segredos. Montagens são read-only.
- Script deploy/t13-controlled-deploy.sh valida origem pelo label OCI
  org.opencontainers.image.revision, executa health check e rollback para
  digest assinado anterior se a nova candidata falhar.
- Não há execução real desses workflows nesta PR. Não há aprovação formal,
  merge, publicação OCI, deploy nem ativação comercial. Falta autoridade
  humana GitHub e configuração real de Firebase/Contabo/GHCR.
