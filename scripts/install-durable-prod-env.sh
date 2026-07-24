#!/usr/bin/env bash
# One-time (or after secret rotation): write durable env for safe-redeploy-service.sh
#
# Prefer dumping from a *healthy* API container so Dokploy-injected secrets
# (Mittera, Polar, OAuth, …) are kept — not only the short bootstrap .env.
#
# On France:
#   bash scripts/install-durable-prod-env.sh
#   # or with an explicit container:
#   bash scripts/install-durable-prod-env.sh briven-brivenfrance-uilsk6-api-1

set -euo pipefail

OUT="${BRIVEN_DURABLE_ENV:-/etc/dokploy/compose/briven-brivenfrance-uilsk6/.env.prod}"
CONTAINER="${1:-briven-brivenfrance-uilsk6-api-1}"
BOOTSTRAP="${BRIVEN_BOOTSTRAP_ENV:-/opt/briven_deploy/infra/dokploy/.env}"
mkdir -p "$(dirname "$OUT")"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "dumping env from healthy container: $CONTAINER"
  docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' >"$TMP"
else
  echo "container $CONTAINER not running — using bootstrap only: $BOOTSTRAP"
  if [[ ! -f "$BOOTSTRAP" ]]; then
    echo "error: no container and no bootstrap env"
    exit 1
  fi
  # strip comments for env-file compatibility
  grep -v '^\s*#' "$BOOTSTRAP" | grep -v '^\s*$' >"$TMP" || true
fi

# Force domain origins
{
  grep -vE '^(BRIVEN_WEB_ORIGIN|BRIVEN_API_ORIGIN|BRIVEN_DOMAIN)=' "$TMP" || true
  echo "BRIVEN_DOMAIN=briven.tech"
  echo "BRIVEN_WEB_ORIGIN=https://briven.tech"
  echo "BRIVEN_API_ORIGIN=https://api.briven.tech"
} >"${TMP}.2"
mv "${TMP}.2" "$TMP"

# Overlay live doltgres password into DATABASE URLs if present
if docker ps --format '{{.Names}}' | grep -qx 'briven-brivenfrance-uilsk6-doltgres-1'; then
  PW="$(
    docker inspect briven-brivenfrance-uilsk6-doltgres-1 \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | sed -n 's/^DOLTGRES_PASSWORD=//p'
  )"
  if [[ -n "$PW" ]]; then
    python3 - "$TMP" "$PW" <<'PY'
import sys, re
path, pw = sys.argv[1], sys.argv[2]
lines = open(path).read().splitlines()
out = []
have = set()
for line in lines:
    if "=" not in line or line.strip().startswith("#"):
        out.append(line)
        continue
    k, v = line.split("=", 1)
    have.add(k)
    if k == "BRIVEN_DOLTGRES_PASSWORD":
        v = pw
    if k in ("BRIVEN_DATABASE_URL", "BRIVEN_ENGINE_DATABASE_URL", "BRIVEN_DATA_PLANE_URL"):
        db = "briven_engine" if "ENGINE" in k else "briven_control"
        v = f"postgres://postgres:{pw}@doltgres:5432/{db}?sslmode=disable"
    out.append(f"{k}={v}")
if "BRIVEN_DOLTGRES_PASSWORD" not in have:
    out.append(f"BRIVEN_DOLTGRES_PASSWORD={pw}")
open(path, "w").write("\n".join(out) + "\n")
PY
  fi
fi

install -m 600 "$TMP" "$OUT"
echo "wrote $OUT (mode 600, $(wc -l <"$OUT") lines)"
echo "use: scripts/safe-redeploy-service.sh api web docs"
