#!/usr/bin/env bash
# Manual or protected-environment controlled deployment on an authorized host.
# Never executed from pull request CI. Requires preprovisioned, private files.
set -Eeuo pipefail
umask 077
[[ $(id -un) == atendevende_t13 ]] || { echo T13_WRONG_RUNTIME_USER >&2; exit 1; }
exec 9>.t13-rollout.lock
flock -n 9 || { echo T13_CONCURRENT_ROLLOUT >&2; exit 1; }
# Immutable approval inputs originate from the protected GitHub environment,
# never from a mutable host runtime file.
APPROVED_REF="${T13_IMAGE_REF:?Signed OCI image required}"
APPROVED_SHA="${T13_EXPECTED_SHA:?Approved post-merge SHA required}"
APPROVED_PROJECT="${T13_EXPECTED_FIREBASE_PROJECT:?Approved Firebase project required}"
readonly APPROVED_REF APPROVED_SHA APPROVED_PROJECT
RUNTIME_ENV="${T13_RUNTIME_ENV_FILE:-.t13-runtime.env}"
[[ -f "$RUNTIME_ENV" && ! -L "$RUNTIME_ENV" ]] ||
 { echo 'HOST_RUNTIME_ENV_NOT_PROVISIONED' >&2; exit 1; }
# Only a private root/operator-controlled file may configure production.
MODE=$(stat -c '%a' "$RUNTIME_ENV")
[[ "$MODE" == "400" || "$MODE" == "600" ]] ||
 { echo 'HOST_RUNTIME_ENV_PERMISSIONS_UNSAFE' >&2; exit 1; }
set -a
# Operator-controlled private host file; NEVER transmitted from the repository.
. "$RUNTIME_ENV"
set +a
T13_IMAGE_REF="$APPROVED_REF"
T13_EXPECTED_SHA="$APPROVED_SHA"
# Never inherit the rootful daemon or an ambient Docker context.
unset DOCKER_CONTEXT
export DOCKER_HOST=unix:///run/t13-docker/docker.sock
[[ "${T13_WORKER_AUTHORITY_CONFIRMED:-}" == true ]] || { echo T13_WORKER_AUTHORITY_NOT_CONFIRMED >&2; exit 1; }
: "${T13_IMAGE_REF:?Signed OCI image digest required}"
: "${FIREBASE_PROJECT_ID:?Firestore project required}"
[[ "$APPROVED_PROJECT" =~ ^[a-z][a-z0-9-]{3,62}$ && "$FIREBASE_PROJECT_ID" == "$APPROVED_PROJECT" ]] || { echo T13_FIREBASE_PROJECT_MISMATCH >&2; exit 1; }
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
docker info --format '{{json .SecurityOptions}}' | python3 -c 'import json,sys; assert "name=rootless" in json.load(sys.stdin)' || { echo T13_ROOTLESS_ENGINE_REQUIRED >&2; exit 1; }
COMPOSE="${T13_COMPOSE_FILE:-deploy/t13-production.compose.yaml}"
STATE="${T13_DEPLOY_STATE_FILE:-.t13-certified-image}"
[[ -f "$COMPOSE" ]] || { echo 'PRODUCTION_COMPOSE_MISSING' >&2; exit 1; }
PREVIOUS=''
if [[ -f "$STATE" ]]; then
 PREVIOUS=$(cat "$STATE")
 [[ "$PREVIOUS" =~ ^ghcr[.]io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[a-f0-9]{64}$ ]] ||
  { echo 'PREVIOUS_DIGEST_INVALID' >&2; exit 1; }
fi
REPO='faabio3131/ai-sales-saas-vendedor-ia'
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
compose(){ docker compose -p atendevende-t13 -f "$COMPOSE" -f "$WORKER_COMPOSE" "$@"; }
PORT="${ATENDEVENDE_PRODUCTION_PORT:-18080}"
[[ "$PORT" =~ ^[0-9]{2,5}$ ]] && (( 10#$PORT >= 1024 && 10#$PORT <= 65535 )) || { echo INVALID_API_PORT >&2; exit 1; }
[[ "$PORT" == 18080 ]] || { echo T13_UNEXPECTED_PORT >&2; exit 1; }
umask 077
HEALTH_JSON=$(mktemp /tmp/t13-release-health.XXXXXXXX)
trap 'rm -f "$HEALTH_JSON"' EXIT
health(){
 curl --silent --fail --max-time 3 "http://127.0.0.1:$PORT/api/health" >"$HEALTH_JSON" &&
 python3 -c 'import json,sys; x=json.load(open(sys.argv[1])); assert x["status"]=="ok" and x["governance"]["tenantIsolationEnforced"] is True' "$HEALTH_JSON"
}
ready(){
 local expected="$1" service cid actual
 for service in atendevende-api payment-reconciler; do
  cid=$(compose ps -q "$service") || return 1
  [[ -n "$cid" && "$cid" != *$'\n'* ]] || return 1
  actual=$(docker inspect --format '{{.Config.Image}} {{.State.Health.Status}}' "$cid") || return 1
  [[ "$actual" == "$expected healthy" ]] || return 1
 done
 health
}
compose config --quiet
# A state-less rollout cannot adopt pre-existing services of unknown provenance.
existing=$(compose ps -aq)
if [[ -z "$PREVIOUS" && -n "$existing" ]]; then
 echo T13_UNTRACKED_PREVIOUS_SERVICES >&2; exit 1
fi
# Check rollback image and both existing services before touching any live process.
if [[ -n "$PREVIOUS" ]]; then
 verify_image "$PREVIOUS"
 docker pull "$PREVIOUS"
 ready "$PREVIOUS" || { echo T13_PREVIOUS_RUNTIME_NOT_HEALTHY >&2; exit 1; }
fi
compose pull
changed=0
committed=0
recover(){
 local rc=$?
 trap - EXIT
 if (( changed && ! committed )); then
  echo T13_ROLLOUT_FAILED_ROLLBACK >&2
  if ! compose stop payment-reconciler atendevende-api; then
   echo T13_CANDIDATE_STOP_FAILED_MANUAL_RECOVERY_REQUIRED >&2
  elif [[ -n "$PREVIOUS" ]]; then
   export ATENDEVENDE_IMAGE="$PREVIOUS"
   if compose up -d --no-build --force-recreate --wait --wait-timeout 180 atendevende-api &&
      health &&
      compose up -d --no-build --force-recreate --wait --wait-timeout 600 payment-reconciler &&
      ready "$PREVIOUS"; then
    echo T13_ROLLBACK_HEALTH_VERIFIED >&2
   else
    compose stop payment-reconciler atendevende-api || true
    echo T13_ROLLBACK_FAILED_MANUAL_RECOVERY_REQUIRED >&2
   fi
  else
   echo T13_FIRST_ROLLOUT_STOPPED_NO_PREVIOUS_DIGEST >&2
  fi
  (( rc != 0 )) || rc=1
 fi
 rm -f "$HEALTH_JSON"
 exit "$rc"
}
trap recover EXIT
changed=1
# Stop the old worker before replacing the API, then certify API before worker start.
compose stop payment-reconciler
compose up -d --no-build --force-recreate --wait --wait-timeout 180 atendevende-api
health
compose up -d --no-build --force-recreate --wait --wait-timeout 600 payment-reconciler
ready "$T13_IMAGE_REF"
umask 077
temp=$(mktemp "$STATE.tmp.XXXXXX")
printf '%s\n' "$T13_IMAGE_REF" > "$temp"
mv -f "$temp" "$STATE"
committed=1
echo "T13_DEPLOY_HEALTH_VERIFIED:$T13_IMAGE_REF"
echo 'COMMERCIAL_PILOT_FLAGS_REMAIN_FALSE'
