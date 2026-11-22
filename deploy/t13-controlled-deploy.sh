#!/usr/bin/env bash
# Manual or protected-environment controlled deployment on an authorized host.
# Never executed from pull request CI. Requires preprovisioned, private files.
set -Eeuo pipefail
RUNTIME_ENV="${T13_RUNTIME_ENV_FILE:-.t13-runtime.env}"
[[ -f "$RUNTIME_ENV" && ! -L "$RUNTIME_ENV" ]] ||
 { echo 'HOST_RUNTIME_ENV_NOT_PROVISIONED' >&2; exit 1; }
set -a
# Operator-controlled private host file; NEVER transmitted from the repository.
. "$RUNTIME_ENV"
set +a
: "${T13_IMAGE_REF:?Signed OCI image digest required}"
: "${FIREBASE_PROJECT_ID:?Firestore project required}"
: "${T13_SESSION_SECRET_FILE:?Private session secret required}"
: "${PAYMENT_FIREBASE_CREDENTIAL_FILE:?Private Firebase credentials required}"
: "${PUBLIC_APP_URL:?Public HTTPS URL required}"
[[ "$T13_IMAGE_REF" =~ ^ghcr[.]io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ ]] ||
 { echo 'INVALID_IMAGE_DIGEST' >&2; exit 1; }
[[ "$PUBLIC_APP_URL" == https://* ]] || { echo 'HTTPS_REQUIRED' >&2; exit 1; }
for filename in "$T13_SESSION_SECRET_FILE" "$PAYMENT_FIREBASE_CREDENTIAL_FILE"; do
 [[ -f "$filename" && ! -L "$filename" ]] ||
  { echo 'PRIVATE_SECRET_MOUNT_REQUIRED' >&2; exit 1; }
done
command -v docker >/dev/null
command -v cosign >/dev/null
command -v curl >/dev/null
command -v python3 >/dev/null
COMPOSE="${T13_COMPOSE_FILE:-deploy/t13-production.compose.yaml}"
STATE="${T13_DEPLOY_STATE_FILE:-.t13-certified-image}"
[[ -f "$COMPOSE" ]] || { echo 'PRODUCTION_COMPOSE_MISSING' >&2; exit 1; }
PREVIOUS=''
if [[ -f "$STATE" ]]; then
 PREVIOUS=$(cat "$STATE")
 [[ "$PREVIOUS" =~ ^ghcr[.]io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ ]] ||
  { echo 'PREVIOUS_DIGEST_INVALID' >&2; exit 1; }
fi
REPO="${T13_SIGNED_REPOSITORY:-faabio3131/ai-sales-saas-vendedor-ia}"
IDENTITY="https://github.com/$REPO/.github/workflows/t13-certified-release.yml@refs/heads/main"
verify_image(){
 cosign verify --certificate-identity "$IDENTITY" \
   --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' "$1" >/dev/null
}
verify_image "$T13_IMAGE_REF"
EXPECTED_SHA="${T13_EXPECTED_SHA:?Approved main SHA required}"
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || exit 1
docker pull "$T13_IMAGE_REF"
IMAGE_REVISION=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$T13_IMAGE_REF")
[[ "$IMAGE_REVISION" = "$EXPECTED_SHA" ]] ||
 { echo 'OCI_SOURCE_SHA_MISMATCH' >&2; exit 1; }
export ATENDEVENDE_IMAGE="$T13_IMAGE_REF"
WORKER_COMPOSE='deploy/payment-reconciler.compose.yaml'
[[ -f "$WORKER_COMPOSE" ]] || { echo 'PAYMENT_WORKER_COMPOSE_MISSING' >&2; exit 1; }
docker compose -f "$COMPOSE" -f "$WORKER_COMPOSE" config --quiet
docker compose -f "$COMPOSE" -f "$WORKER_COMPOSE" pull
docker compose -f "$COMPOSE" -f "$WORKER_COMPOSE" up -d --no-build --force-recreate
PORT="${ATENDEVENDE_PRODUCTION_PORT:-18080}"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] || { echo 'INVALID_API_PORT' >&2; exit 1; }
READY=0
for attempt in $(seq 1 40); do
 if curl --silent --fail --max-time 3 "http://127.0.0.1:$PORT/api/health" >/tmp/t13-release-health.json; then
  if python3 -c 'import json; x=json.load(open("/tmp/t13-release-health.json")); assert x["status"]=="ok" and x["governance"]["tenantIsolationEnforced"] is True'; then
   READY=1
   break
  fi
 fi
 sleep 3
done
if [[ "$READY" != 1 ]]; then
 echo 'DEPLOY_HEALTH_FAILED: ROLLBACK' >&2
 if [[ -n "$PREVIOUS" && "$PREVIOUS" != "$T13_IMAGE_REF" ]]; then
  verify_image "$PREVIOUS"
  export ATENDEVENDE_IMAGE="$PREVIOUS"
  docker compose -f "$COMPOSE" -f "$WORKER_COMPOSE" pull
  docker compose -f "$COMPOSE" -f "$WORKER_COMPOSE" up -d --no-build --force-recreate
 else
  echo 'NO_PREVIOUS_CERTIFIED_DIGEST: MANUAL_RECOVERY_REQUIRED' >&2
 fi
 exit 1
fi
umask 077
temp=$(mktemp "$STATE.tmp.XXXXXX")
printf '%s\n' "$T13_IMAGE_REF" > "$temp"
mv -f "$temp" "$STATE"
echo "T13_DEPLOY_HEALTH_VERIFIED:$T13_IMAGE_REF"
echo 'COMMERCIAL_PILOT_FLAGS_REMAIN_FALSE'
