#!/usr/bin/env bash
# Run one suite against a fresh, checksum-pinned local emulator. No retries.
set -euo pipefail
[[ "$#" -ge 2 && "$1" =~ ^[a-z0-9-]+$ ]]
SUITE="$1"
shift
[[ "${NODE_ENV:-}" == test && "${T10_FIRESTORE_EMULATOR:-}" == true ]]
[[ "${FIRESTORE_EMULATOR_HOST:-}" == 127.0.0.1:8089 && "${FIREBASE_PROJECT_ID:-}" == demo-atendevende-t10 ]]
[[ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]]
node scripts/t13FirestoreEmulatorIntegrity.mjs /tmp/firestore-emulator.jar
if curl --silent --max-time 2 http://127.0.0.1:8089/ >/dev/null; then
  echo "FIRESTORE_EMULATOR_ALREADY_LISTENING:$SUITE" >&2
  exit 1
fi
LOG=$(mktemp)
java -jar /tmp/firestore-emulator.jar --host 127.0.0.1 --port 8089 --project_id demo-atendevende-t10 --rules deploy/t10-scheduling.firestore.rules > "$LOG" 2>&1 &
PID=$!
cleanup() {
  local status=$?
  trap - EXIT
  kill "$PID" >/dev/null 2>&1 || true
  wait "$PID" 2>/dev/null || true
  printf '\nFIRESTORE_SUITE_LOG_BEGIN:%s\n' "$SUITE"
  cat "$LOG"
  printf '\nFIRESTORE_SUITE_LOG_END:%s:exit=%s\n' "$SUITE" "$status"
  rm -f "$LOG"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
READY=0
for i in {1..60}; do
  kill -0 "$PID" 2>/dev/null || break
  if curl --silent --fail --max-time 2 http://127.0.0.1:8089/ >/dev/null; then
    READY=1
    break
  fi
  sleep 1
done
test "$READY" = 1
kill -0 "$PID"
printf 'FIRESTORE_SUITE_BEGIN:%s:pid=%s\n' "$SUITE" "$PID"
"$@"
kill -0 "$PID"
printf 'FIRESTORE_SUITE_PASS:%s\n' "$SUITE"
