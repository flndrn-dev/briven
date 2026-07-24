#!/usr/bin/env bash
# Safe service-scoped redeploy for Briven France (compose project briven-brivenfrance-uilsk6).
#
# Why: bare `docker compose up --build` without the Dokploy-managed env blanks
# secrets and can take down api.briven.tech. This script always loads durable env
# first, then rebuilds only the services you name.
#
# On France:
#   /etc/dokploy/compose/briven-brivenfrance-uilsk6/code/scripts/safe-redeploy-service.sh api
#   /etc/dokploy/compose/briven-brivenfrance-uilsk6/code/scripts/safe-redeploy-service.sh api web docs
#
# Env sources (first that exists wins, then layered):
#   1) /etc/dokploy/compose/briven-brivenfrance-uilsk6/.env.prod  (durable secrets)
#   2) /opt/briven_deploy/infra/dokploy/.env                     (bootstrap secrets)
# Live Doltgres password always overrides from the running doltgres container.

set -euo pipefail

COMPOSE_DIR="${BRIVEN_COMPOSE_DIR:-/etc/dokploy/compose/briven-brivenfrance-uilsk6/code}"
PROJECT="${BRIVEN_COMPOSE_PROJECT:-briven-brivenfrance-uilsk6}"
FILE="${BRIVEN_COMPOSE_FILE:-infra/dokploy/compose.dokploy.yml}"
DURABLE_ENV="${BRIVEN_DURABLE_ENV:-/etc/dokploy/compose/briven-brivenfrance-uilsk6/.env.prod}"
BOOTSTRAP_ENV="${BRIVEN_BOOTSTRAP_ENV:-/opt/briven_deploy/infra/dokploy/.env}"

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <service> [service...]"
  echo "examples: $0 api | $0 api web | $0 docs"
  exit 1
fi

if [[ ! -d "$COMPOSE_DIR" ]]; then
  echo "error: compose dir not found: $COMPOSE_DIR (run on France)"
  exit 1
fi

cd "$COMPOSE_DIR"

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  . "$f"
  set +a
  echo "loaded env: $f"
}

load_env_file "$BOOTSTRAP_ENV"
load_env_file "$DURABLE_ENV"

# Live Doltgres password (container is source of truth)
if docker ps --format '{{.Names}}' | grep -qx 'briven-brivenfrance-uilsk6-doltgres-1'; then
  LIVE_PW="$(
    docker inspect briven-brivenfrance-uilsk6-doltgres-1 \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | sed -n 's/^DOLTGRES_PASSWORD=//p'
  )"
  if [[ -n "${LIVE_PW:-}" ]]; then
    export BRIVEN_DOLTGRES_PASSWORD="$LIVE_PW"
    echo "loaded live DOLTGRES password from container"
  fi
fi

export BRIVEN_DOMAIN="${BRIVEN_DOMAIN:-briven.tech}"
export BRIVEN_DOMAIN="${BRIVEN_DOMAIN#https://}"
export BRIVEN_DOMAIN="${BRIVEN_DOMAIN#http://}"
export BRIVEN_DOMAIN="${BRIVEN_DOMAIN%%/*}"

if [[ -z "${BRIVEN_DOLTGRES_PASSWORD:-}" ]]; then
  echo "error: BRIVEN_DOLTGRES_PASSWORD empty — fix $DURABLE_ENV or doltgres container"
  exit 1
fi
if [[ -z "${BRIVEN_ENCRYPTION_KEY:-}" || -z "${BRIVEN_BETTER_AUTH_SECRET:-}" ]]; then
  echo "error: missing core secrets — copy a full env into $DURABLE_ENV"
  exit 1
fi

echo "redeploying: $*  (project=$PROJECT domain=$BRIVEN_DOMAIN)"
docker compose -p "$PROJECT" -f "$FILE" build "$@"
docker compose -p "$PROJECT" -f "$FILE" up -d --force-recreate --no-deps "$@"

echo "done. verify:"
echo "  curl -sS https://api.briven.tech/info | head -c 200"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://docs.briven.tech/auth/parity"
