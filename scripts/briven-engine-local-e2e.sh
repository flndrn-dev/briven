#!/usr/bin/env bash
# Local end-to-end smoke for briven-engine (NO production deploy).
#
# 1) Starts local compose (postgres + briven-engine) if not already up
# 2) Proves Core /hello
# 3) Optionally hits a local API if BRIVEN_API_ORIGIN is set
#
# Usage:
#   chmod +x scripts/briven-engine-local-e2e.sh
#   ./scripts/briven-engine-local-e2e.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE="$ROOT/infra/dokploy/compose.briven-engine.local.yml"
ENGINE_URL="${BRIVEN_ENGINE_CONNECTION_URI:-http://127.0.0.1:3567}"
API_URL="${BRIVEN_API_ORIGIN:-}"

echo "==> briven-engine local e2e (deploy gate: local only)"
echo "    ENGINE_URL=$ENGINE_URL"

if ! command -v docker >/dev/null 2>&1; then
  echo "✖ docker not found — cannot start local engine"
  exit 1
fi

export BRIVEN_POSTGRES_PASSWORD="${BRIVEN_POSTGRES_PASSWORD:-devpass}"

echo "==> ensure local compose is up"
# Prefer docker-compose v2 standalone (some docker CLI wrappers reject `compose -f`)
if command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose -f "$COMPOSE")
elif docker compose version >/dev/null 2>&1; then
  DC=(docker compose -f "$COMPOSE")
else
  echo "✖ neither docker-compose nor docker compose available"
  exit 1
fi
"${DC[@]}" up -d

echo "==> wait for /hello"
ok=0
for i in $(seq 1 40); do
  if curl -sf "$ENGINE_URL/hello" | grep -qi hello; then
    ok=1
    break
  fi
  sleep 1
done

if [[ "$ok" -ne 1 ]]; then
  echo "✖ briven-engine did not become healthy at $ENGINE_URL"
  "${DC[@]}" ps || true
  "${DC[@]}" logs --tail=80 briven-engine || true
  exit 1
fi

HELLO=$(curl -sf "$ENGINE_URL/hello" | tr -d '\r')
echo "✔ Core hello: $HELLO"

# CDI-style signup is via API/SDK, not raw Core. If API is running with
# BRIVEN_ENGINE_CONNECTION_URI pointing here, try FDI emailpassword signup.
if [[ -n "$API_URL" ]]; then
  API_URL="${API_URL%/}"
  echo "==> probe API auth-core ($API_URL)"
  curl -sf "$API_URL/v1/auth-core/info" | head -c 400 || true
  echo

  EMAIL="e2e_$(date +%s)@example.com"
  PASS='E2eTest!Pass99'
  PROJECT="${BRIVEN_E2E_PROJECT_ID:-p_e2e_local}"

  echo "==> attempt EmailPassword sign-up via FDI (project=$PROJECT)"
  # SuperTokens EP signup path under apiBasePath
  CODE=$(curl -sS -o /tmp/briven-engine-e2e-signup.json -w '%{http_code}' \
    -X POST "$API_URL/v1/auth-core/fdi/signup" \
    -H 'content-type: application/json' \
    -H 'rid: emailpassword' \
    -H "x-briven-project-id: $PROJECT" \
    -H 'x-briven-engine: briven-engine' \
    -d "{\"formFields\":[{\"id\":\"email\",\"value\":\"$EMAIL\"},{\"id\":\"password\",\"value\":\"$PASS\"}]}" \
    || true)

  echo "    HTTP $CODE"
  head -c 500 /tmp/briven-engine-e2e-signup.json 2>/dev/null || true
  echo

  if [[ "$CODE" == "200" ]]; then
    echo "✔ sign-up response 200 — check JSON status field"
  else
    echo "⚠ sign-up not 200 (API may lack SDK init or recipes). Engine /hello still OK."
  fi
else
  echo "==> skip API sign-up (set BRIVEN_API_ORIGIN=http://localhost:3001 to include)"
fi

echo "==> done. briven-engine is local-only; production deploy still blocked."
