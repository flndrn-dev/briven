#!/usr/bin/env bash
# Realtime-subscriptions load test runner.
#
# Wraps infra/load-tests/realtime-subs.ts with sensible defaults so the
# Phase 2 exit criterion (1,000 concurrent subs on KVM4 with p99 fan-out
# under 500ms, zero connection failures) can be exercised with one
# command. Writes the run summary to ./tmp/load-tests/<utc-timestamp>.txt
# so subsequent runs are comparable.
#
# Required env:
#   BRIVEN_RUNTIME_SHARED_SECRET  — the shared secret the realtime
#     service expects on subscribe; see infra/dokploy/.env on the host.
#   BRIVEN_LOAD_TEST_PROJECT_ID   — the project to fan out to.
#   BRIVEN_LOAD_TEST_FUNCTION     — a deployed function name (any cheap one).
#
# Optional:
#   BRIVEN_LOAD_TEST_URL          — wss URL. Defaults to wss://realtime.briven.tech.
#   BRIVEN_LOAD_TEST_SUBS         — concurrent connection count. Default 1000.
#   BRIVEN_LOAD_TEST_DURATION     — seconds to hold. Default 60.

set -euo pipefail

: "${BRIVEN_RUNTIME_SHARED_SECRET:?env required}"
: "${BRIVEN_LOAD_TEST_PROJECT_ID:?env required}"
: "${BRIVEN_LOAD_TEST_FUNCTION:?env required}"

URL="${BRIVEN_LOAD_TEST_URL:-wss://realtime.briven.tech}"
SUBS="${BRIVEN_LOAD_TEST_SUBS:-1000}"
DURATION="${BRIVEN_LOAD_TEST_DURATION:-60}"

OUT_DIR="tmp/load-tests"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/${STAMP}.txt"

echo "running: $SUBS subs against $URL for ${DURATION}s"
echo "output: $OUT_FILE"
echo

bun run infra/load-tests/realtime-subs.ts \
  --url "$URL" \
  --secret "$BRIVEN_RUNTIME_SHARED_SECRET" \
  --project "$BRIVEN_LOAD_TEST_PROJECT_ID" \
  --function "$BRIVEN_LOAD_TEST_FUNCTION" \
  --subs "$SUBS" \
  --duration "$DURATION" \
  2>&1 | tee "$OUT_FILE"

echo
echo "summary saved to $OUT_FILE"
