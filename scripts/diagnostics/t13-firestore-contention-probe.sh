#!/usr/bin/env bash
set -Eeuo pipefail
# Investigation only. This branch and workflow must never be merged.
test "$NODE_ENV" = test
test "$T10_FIRESTORE_EMULATOR" = true
test "$FIRESTORE_EMULATOR_HOST" = 127.0.0.1:8089
test "$FIREBASE_PROJECT_ID" = demo-atendevende-t10
test "$GITHUB_REF" = refs/heads/diagnose/t13-firestore-contention-20261126
test -z "${GOOGLE_APPLICATION_CREDENTIALS:-}"
case "$DIAG_READS" in original|batched) ;; *) exit 2;; esac
case "$DIAG_EMULATOR" in fresh|warmed) ;; *) exit 2;; esac
mkdir -p diagnostic-evidence
printf 'diagnostic-head=%s\nbase=%s\n' "$GITHUB_SHA" f7c0feebe54f604e7b939b2049f12afabeecf7d7 > diagnostic-evidence/identity.txt
# Candidate production files, test, lock and rules must match the exact merged base.
git diff --exit-code f7c0feebe54f604e7b939b2049f12afabeecf7d7 -- src tests package.json package-lock.json deploy
node scripts/diagnostics/t13-firestore-contention-overlay.mjs "$DIAG_READS"
git diff -- src tests > diagnostic-evidence/experiment-overlay.diff
node --version
java -version
node -e 'const p=require("./package-lock.json"); for(const n of ["firebase-admin","@google-cloud/firestore","@grpc/grpc-js","vitest"]) for(const [k,v] of Object.entries(p.packages)) if(k==="node_modules/"+n||k.endsWith("/node_modules/"+n))console.log(k,v.version)'
curl --fail --location --retry 3 --retry-delay 1 --output /tmp/firestore-emulator.jar https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar
node scripts/t13FirestoreEmulatorIntegrity.mjs /tmp/firestore-emulator.jar
printf 'arm\trepetition\twarmup_exit\tvitest_exit\tcoverage_exit\tlock_warnings\tinvalid_warnings\n' > diagnostic-evidence/results.tsv
pid=
cleanup(){
  if [ -n "$pid" ]; then kill "$pid" >/dev/null 2>&1 || true; wait "$pid" 2>/dev/null || true; pid=; fi
}
trap cleanup EXIT
failed=0
# Fixed sample size (not retries); both outcomes are kept.
for rep in 1 2 3; do
  prefix="diagnostic-evidence/rep-$rep"
  rm -rf coverage/evolution-emulator
  java -jar /tmp/firestore-emulator.jar --host 127.0.0.1 --port 8089 --project_id demo-atendevende-t10 --rules deploy/t10-scheduling.firestore.rules > "$prefix-emulator.log" 2>&1 &
  pid=$!
  ready=0
  for i in {1..60}; do
    if curl --silent --fail http://127.0.0.1:8089/ >/dev/null; then ready=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  test "$ready" = 1
  warm=0
  if [ "$DIAG_EMULATOR" = warmed ]; then
    for suite in t10FirestoreEmulator t11FirestoreEmulator t12FirestoreEmulator t13RecoveryFirestoreEmulator; do
      rc=0
      timeout 120s npm test -- "tests/$suite.test.ts" > "$prefix-warm-$suite.log" 2>&1 || rc=$?
      echo "WARMUP_RESULT rep=$rep suite=$suite exit=$rc"
      if [ "$rc" -ne 0 ]; then warm=$rc; fi
    done
  fi
  rc=0
  timeout 120s npm test -- tests/t13EvolutionFirestoreEmulator.test.ts --coverage --coverage.provider=v8 --coverage.include='src/channels/evolution*.ts' --coverage.reporter=json-summary --coverage.reportsDirectory=coverage/evolution-emulator > "$prefix-vitest.log" 2>&1 || rc=$?
  cov=not_run
  if [ "$rc" = 0 ]; then
    cov=0
    node scripts/t13CoverageGate.mjs --evolution-emulator coverage/evolution-emulator/coverage-summary.json > "$prefix-coverage.log" 2>&1 || cov=$?
    cp coverage/evolution-emulator/coverage-summary.json "$prefix-coverage.json"
  fi
  cleanup
  locks=$(grep -c 'WARNING: Operation failed: Transaction lock timeout' "$prefix-emulator.log" || true)
  invalid=$(grep -c 'WARNING: Operation failed: Transaction is invalid or closed' "$prefix-emulator.log" || true)
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$DIAG_READS/$DIAG_EMULATOR" "$rep" "$warm" "$rc" "$cov" "$locks" "$invalid" >> diagnostic-evidence/results.tsv
  echo "DIAGNOSTIC_RESULT reads=$DIAG_READS emulator=$DIAG_EMULATOR rep=$rep warmup=$warm test=$rc coverage=$cov locks=$locks invalid=$invalid"
  grep -E 'DIAG_PHASE|Tests[[:space:]]+[0-9]+ passed|FAIL|INVALID_ARGUMENT' "$prefix-vitest.log" || true
  if [ "$warm" != 0 ] || [ "$rc" != 0 ] || [ "$cov" != 0 ]; then failed=1; fi
done
cat diagnostic-evidence/results.tsv
exit "$failed"
