#!/usr/bin/env bash
# Human-assisted isolation check helper (S6.1 / Clerk gap).
# Does NOT create projects. Prints the exact clicks + optional API probes
# if you pass two project-scoped auth public keys (pk_ only — never brk_ in browser).
#
# Usage:
#   ./scripts/auth-isolation-check.sh
#   ./scripts/auth-isolation-check.sh p_AAA p_BBB
set -euo pipefail

API="${BRIVEN_API_ORIGIN:-https://api.briven.tech}"
A="${1:-}"
B="${2:-}"

cat <<EOF
== Auth isolation check (project A vs project B) ==

In the dashboard (you must do this — takes ~10 minutes):

  1. Project A → Auth → enable (if needed) → create public key pk_… for A
  2. Sign up a user on A's hosted auth / your pilot (e.g. you+a@email.com)
  3. Project B → Auth → enable → create a DIFFERENT public key for B
  4. Project B → Auth → Users
       PASS = user from step 2 is NOT listed
  5. (Optional) Configure a second app with B's project id + B's pk_
       Sign up another user → appears only on B

Why this matters: Clerk multi-app isolation is assumed; we must show it.

Platform readiness (agent):
EOF

./scripts/s6-auth-verify.sh "$API" || true

if [[ -n "$A" && -n "$B" ]]; then
  echo
  echo "Optional: if you export BRIVEN_PEN_TEST_* tokens, run:"
  echo "  BRIVEN_PEN_TEST_RUN=1 BRIVEN_PEN_TEST_TENANT_A_ID=$A BRIVEN_PEN_TEST_TENANT_B_ID=$B \\"
  echo "  BRIVEN_PEN_TEST_API_ORIGIN=$API bun test apps/api/src/services/auth-tenant-isolation.test.ts"
fi

echo
echo "Record results in docs/CLERK-GAP-EVIDENCE.md and AUTH-GO-LIVE-CHECKLIST.md"
