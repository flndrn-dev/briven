#!/usr/bin/env bash
# Deploy main to briven.tech on kvm4. Runs from the operator's local
# machine — wraps git push + ssh pull + docker compose build/up so the
# rollout becomes one command:
#
#   ./scripts/deploy-kvm4.sh                       # api+web+docs
#   ./scripts/deploy-kvm4.sh api                   # just api
#   ./scripts/deploy-kvm4.sh api web docs runtime  # explicit set
#   ./scripts/deploy-kvm4.sh --no-push api         # local build only
#                                                  # (use when konnos is down)
#
# What it does:
#   1. push current HEAD to konnos (skipped with --no-push)
#   2. ssh into kvm4, git stash any drift, git pull origin main
#   3. docker compose build the requested services with
#      BRIVEN_BUILD_SHA + BRIVEN_BUILD_AT injected as build-args so
#      /info reflects the running commit
#   4. up -d --force-recreate the same services
#   5. wait + curl /info on api so the operator sees the new sha live
#
# Doesn't redeploy database / redis / minio — they survive across
# code changes. Pass them explicitly if you need to.

set -euo pipefail

HOST="root@187.124.209.17"
REMOTE_REPO="/etc/dokploy/compose/briven/code"
PROJECT_NAME="briven"
COMPOSE_FILE="infra/dokploy/compose.dokploy.yml"

PUSH=1
SERVICES=()
for arg in "$@"; do
  case "$arg" in
    --no-push) PUSH=0 ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) SERVICES+=("$arg") ;;
  esac
done

if [[ ${#SERVICES[@]} -eq 0 ]]; then
  SERVICES=(api web docs)
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

SHA=$(git rev-parse --short HEAD)
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DIRTY=""
if ! git diff --quiet HEAD; then
  DIRTY=" (dirty tree — uncommitted local changes will NOT deploy)"
fi

echo "→ deploying $SHA at $NOW to $HOST$DIRTY"
echo "→ services: ${SERVICES[*]}"

# ─── 1. push to konnos ─────────────────────────────────────────────────
if [[ "$PUSH" -eq 1 ]]; then
  echo "→ pushing to konnos"
  if ! git push origin main; then
    echo "✖ push to konnos failed. pass --no-push to deploy from rsync only."
    exit 1
  fi
fi

# ─── 2-5. pull + build + up + verify on kvm4 ───────────────────────────
ssh "$HOST" "
set -euo pipefail
cd $REMOTE_REPO

echo '  → stash any drift'
git stash --include-untracked >/dev/null 2>&1 || true

echo '  → git pull origin main'
git pull origin main | tail -3

echo '  → docker compose build (sha=$SHA)'
docker compose --project-name $PROJECT_NAME --env-file .env -f $COMPOSE_FILE build \
  --build-arg BRIVEN_BUILD_SHA=$SHA --build-arg BRIVEN_BUILD_AT='$NOW' \
  ${SERVICES[*]} 2>&1 | tail -3

echo '  → docker compose up -d --force-recreate'
docker compose --project-name $PROJECT_NAME --env-file .env -f $COMPOSE_FILE up -d \
  --force-recreate --no-deps ${SERVICES[*]} 2>&1 | tail -3

if printf '%s\n' ${SERVICES[*]} | grep -q '^api$'; then
  sleep 5
  echo
  echo '  → verify /info reflects the new build'
  curl -sS https://api.briven.tech/info
  echo
fi
"

echo "✔ deploy complete"
