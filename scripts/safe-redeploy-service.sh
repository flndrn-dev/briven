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

# Live MinIO root password is source of truth for S3 access.
# Compose wires BOTH minio.MINIO_ROOT_PASSWORD and api.BRIVEN_MINIO_SECRET_KEY
# from ${BRIVEN_MINIO_ROOT_PASSWORD}. If durable/bootstrap has a different
# value than the already-running MinIO volume, logo uploads fail with
# SignatureDoesNotMatch (and older UI surfaces a confusing 410 on fallback).
if docker ps --format '{{.Names}}' | grep -qx 'briven-brivenfrance-uilsk6-minio-1'; then
  LIVE_MINIO_PW="$(
    docker inspect briven-brivenfrance-uilsk6-minio-1 \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | sed -n 's/^MINIO_ROOT_PASSWORD=//p'
  )"
  if [[ -n "${LIVE_MINIO_PW:-}" ]]; then
    export BRIVEN_MINIO_ROOT_PASSWORD="$LIVE_MINIO_PW"
    export BRIVEN_MINIO_SECRET_KEY="$LIVE_MINIO_PW"
    # Keep durable env in lockstep so the next redeploy does not drift again.
    if [[ -f "$DURABLE_ENV" ]]; then
      if grep -q '^BRIVEN_MINIO_ROOT_PASSWORD=' "$DURABLE_ENV"; then
        tmp=$(mktemp)
        while IFS= read -r line || [[ -n "$line" ]]; do
          case "$line" in
            BRIVEN_MINIO_ROOT_PASSWORD=*) echo "BRIVEN_MINIO_ROOT_PASSWORD=$LIVE_MINIO_PW" ;;
            BRIVEN_MINIO_SECRET_KEY=*) echo "BRIVEN_MINIO_SECRET_KEY=$LIVE_MINIO_PW" ;;
            *) printf '%s\n' "$line" ;;
          esac
        done < "$DURABLE_ENV" > "$tmp"
        mv "$tmp" "$DURABLE_ENV"
      else
        printf '\nBRIVEN_MINIO_ROOT_PASSWORD=%s\nBRIVEN_MINIO_SECRET_KEY=%s\n' \
          "$LIVE_MINIO_PW" "$LIVE_MINIO_PW" >> "$DURABLE_ENV"
      fi
      chmod 600 "$DURABLE_ENV"
    fi
    echo "loaded live MINIO root password from container (len=${#LIVE_MINIO_PW})"
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

# Branding + OAuth secrets live in the encrypted tenant-secret store and need
# BRIVEN_AUTH_MASTER_KEY (64 hex chars). Without it, dashboard Auth → branding
# save returns "master key not configured for service: auth" and nothing sticks.
if [[ -z "${BRIVEN_AUTH_MASTER_KEY:-}" || ! "${BRIVEN_AUTH_MASTER_KEY}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  if [[ -f "$DURABLE_ENV" ]]; then
    GEN=$(openssl rand -hex 32)
    if grep -q '^BRIVEN_AUTH_MASTER_KEY=' "$DURABLE_ENV"; then
      tmp=$(mktemp)
      while IFS= read -r line || [[ -n "$line" ]]; do
        case "$line" in
          BRIVEN_AUTH_MASTER_KEY=*) echo "BRIVEN_AUTH_MASTER_KEY=$GEN" ;;
          *) printf '%s\n' "$line" ;;
        esac
      done < "$DURABLE_ENV" > "$tmp"
      mv "$tmp" "$DURABLE_ENV"
    else
      printf '\nBRIVEN_AUTH_MASTER_KEY=%s\n' "$GEN" >> "$DURABLE_ENV"
    fi
    chmod 600 "$DURABLE_ENV"
    export BRIVEN_AUTH_MASTER_KEY="$GEN"
    echo "generated BRIVEN_AUTH_MASTER_KEY into $DURABLE_ENV (was missing/invalid)"
  else
    echo "error: BRIVEN_AUTH_MASTER_KEY missing and no durable env at $DURABLE_ENV"
    exit 1
  fi
fi
export BRIVEN_AUTH_MASTER_KEY
echo "BRIVEN_AUTH_MASTER_KEY loaded (len=${#BRIVEN_AUTH_MASTER_KEY})"

echo "redeploying: $*  (project=$PROJECT domain=$BRIVEN_DOMAIN)"
docker compose -p "$PROJECT" -f "$FILE" build "$@"
docker compose -p "$PROJECT" -f "$FILE" up -d --force-recreate --no-deps "$@"

echo "done. verify:"
echo "  curl -sS https://api.briven.tech/info | head -c 200"
echo "  curl -sS -o /dev/null -w '%{http_code}\\n' https://docs.briven.tech/auth/parity"
if [[ " $* " == *" api "* ]] || [[ "$*" == "api" ]]; then
  echo "  docker exec briven-brivenfrance-uilsk6-api-1 sh -c 'echo AUTH_MASTER=\${BRIVEN_AUTH_MASTER_KEY:+SET}'"
fi
