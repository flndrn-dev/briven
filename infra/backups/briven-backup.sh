#!/usr/bin/env bash
# Daily backup of Briven — Doltgres-native (PRIMARY DR) + stock-Postgres pg_dump
# (secondary rollback). Runs on the France host via systemd
# (briven-backup.{service,timer}).
#
# 2026-08-01 REWORK — why this changed:
#   The old `dolt-backup` SIDECAR looped `dolt_backup('sync-url', …)` over EVERY
#   database with no throttle, against a buggy DoltGres 0.56.6. That contributed
#   to a full-platform outage (engine locked under load). Fix: engine upgraded to
#   0.57.2 (lock-subsystem fixes) with auto-GC disabled, and backups are now a
#   GENTLE, one-database-at-a-time, throttled pass run from this host job. The
#   sidecar is removed from compose. Proven safe under monitoring (2026-08-01).
#
# Backup layers:
#   1. PRIMARY  — `dolt_backup('sync-url', file:///backups/<db>)` for ALL live
#                 DoltGres DBs (control + engine + every project) → doltgres_backups
#                 volume (/backups). Restorable via `dolt backup restore`.
#   2. auth.db  — snapshot the engine users/grants file (nothing else backs it up).
#   3. SECONDARY— pg_dump of stock-Postgres briven_control (rollback window helper).
#   4. OFF-SITE — mirror the doltgres_backups volume to external S3 (Backblaze/R2/…)
#                 when BRIVEN_BACKUP_S3_* is configured (see BACKUP-OFFSITE.md).
#
# Env (/etc/briven/backup.env, optional):
#   BRIVEN_DOLTGRES_CONTAINER          default: briven-brivenfrance-uilsk6-doltgres-1
#   BRIVEN_DOLTGRES_BACKUPS_VOLUME     default: briven-brivenfrance-uilsk6_doltgres_backups
#   BRIVEN_DOLTGRES_PASSWORD           default: read from the doltgres container env
#   BRIVEN_BACKUP_THROTTLE_SECS        default: 8  (pause between DBs — gentleness)
#   BRIVEN_BACKUP_PG_CONTAINER         default: briven-brivenfrance-uilsk6-postgres-1
#   BRIVEN_BACKUP_PG_USER              default: postgres
#   BRIVEN_BACKUP_PG_DBS               default: briven_control (secondary pg_dump)
#   BRIVEN_BACKUP_S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY  → off-site mirror
#   BRIVEN_BACKUP_LOCAL_RETENTION_DAYS default: 30
#
# Exit 1 if the dolt phase fails for any DB OR an off-site mirror fails, so
# OnFailure=briven-backup-alert.service fires.

set -euo pipefail

BACKUP_ENV_FILE="/etc/briven/backup.env"
if [ -f "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
fi

DC="${BRIVEN_DOLTGRES_CONTAINER:-briven-brivenfrance-uilsk6-doltgres-1}"
BACKUPS_VOLUME="${BRIVEN_DOLTGRES_BACKUPS_VOLUME:-briven-brivenfrance-uilsk6_doltgres_backups}"
THROTTLE="${BRIVEN_BACKUP_THROTTLE_SECS:-8}"
PG_CONTAINER="${BRIVEN_BACKUP_PG_CONTAINER:-briven-brivenfrance-uilsk6-postgres-1}"
PG_USER="${BRIVEN_BACKUP_PG_USER:-postgres}"
# shellcheck disable=SC2206
PG_DBS=(${BRIVEN_BACKUP_PG_DBS:-briven_control})
LOCAL_BACKUP_ROOT="/var/backups/briven"
LOCAL_RETENTION_DAYS="${BRIVEN_BACKUP_LOCAL_RETENTION_DAYS:-30}"

STAMP="$(date -u +'%Y-%m-%d/%H-%M-%S')"
STAMP_FLAT="$(date -u +'%Y-%m-%dT%H-%M-%SZ')"
FAILURES=0
FAILURE_DETAIL=""

log()  { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die()  { log "ERROR: $*"; exit 1; }
fail() { log "WARN: $*"; FAILURES=$((FAILURES + 1)); FAILURE_DETAIL="${FAILURE_DETAIL:+${FAILURE_DETAIL}; }$*"; }

# --- resolve doltgres password without printing it ---
dolt_password() {
  if [ -n "${BRIVEN_DOLTGRES_PASSWORD:-}" ]; then
    printf '%s' "$BRIVEN_DOLTGRES_PASSWORD"; return 0
  fi
  docker inspect "$DC" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^DOLTGRES_PASSWORD=//p' | head -1
}

# ===== PHASE 1: PRIMARY — gentle DoltGres-native backup of every live DB =====
dolt_backup_all() {
  docker inspect "$DC" >/dev/null 2>&1 || die "doltgres container not found: ${DC}"
  local pw; pw="$(dolt_password)"
  [ -n "$pw" ] || die "could not resolve DOLTGRES_PASSWORD"
  local base="postgres://postgres:${pw}@127.0.0.1:5432"

  log "dolt phase: enumerating live databases"
  local dbs ok=0
  dbs="$(docker exec "$DC" sh -lc \
    "psql \"${base}/postgres?sslmode=disable\" -tAc \"select datname from pg_database where datname not in ('template0','template1','postgres')\"" \
    2>/dev/null || true)"
  [ -n "$dbs" ] || die "no databases enumerated (is doltgres serving?)"

  for db in $dbs; do
    # sync-url writes a restorable dolt archive to the server's /backups/<db>.
    if docker exec "$DC" sh -lc \
         "psql \"${base}/${db}?sslmode=disable\" -tAc \"select dolt_backup('sync-url','file:///backups/${db}')\"" \
         >/dev/null 2>&1; then
      log "  ok  dolt backup: ${db}"
      ok=$((ok + 1))
    else
      fail "dolt backup failed: ${db}"
    fi
    sleep "$THROTTLE"   # gentleness — never hammer the engine
  done
  log "dolt phase: ${ok} database(s) backed up (throttle=${THROTTLE}s)"

  # auth.db snapshot — engine users/grants; keep newest 14.
  if docker exec "$DC" test -f /var/lib/doltgres/auth.db 2>/dev/null; then
    if docker exec "$DC" sh -lc \
         "mkdir -p /backups/auth-db && cp /var/lib/doltgres/auth.db /backups/auth-db/auth.db.${STAMP_FLAT} && ls -1t /backups/auth-db | tail -n +15 | while read -r f; do rm -f \"/backups/auth-db/\$f\"; done" \
         >/dev/null 2>&1; then
      log "  ok  auth.db snapshot"
    else
      fail "auth.db snapshot failed"
    fi
  fi
}

# ===== PHASE 2: SECONDARY — pg_dump of stock-Postgres (rollback window) =====
pg_dump_secondary() {
  docker inspect "$PG_CONTAINER" >/dev/null 2>&1 || { log "pg secondary: container ${PG_CONTAINER} absent — skipping"; return 0; }
  for db in "${PG_DBS[@]}"; do
    local dir="${LOCAL_BACKUP_ROOT}/${db}/${STAMP%/*}"
    local file="${dir}/${STAMP##*/}.dump.gz"
    mkdir -p "$dir"
    if docker exec "$PG_CONTAINER" pg_dump --username="$PG_USER" --format=custom --compress=0 \
         --no-owner --no-privileges "$db" 2>/dev/null | gzip -9 > "$file"; then
      log "  ok  pg_dump ${db}: $(stat -c%s "$file") bytes"
    else
      rm -f "$file"; fail "pg_dump failed: ${db}"
    fi
  done
}

# ===== PHASE 3: OFF-SITE — mirror the dolt backups volume to external S3 =====
offsite_mirror() {
  if [ -z "${BRIVEN_BACKUP_S3_ENDPOINT:-}" ] || [ -z "${BRIVEN_BACKUP_S3_BUCKET:-}" ] \
     || [ -z "${BRIVEN_BACKUP_S3_ACCESS_KEY:-}" ] || [ -z "${BRIVEN_BACKUP_S3_SECRET_KEY:-}" ]; then
    log "off-site mirror skipped (BRIVEN_BACKUP_S3_* unset) — see BACKUP-OFFSITE.md"
    return 0
  fi
  local ep="${BRIVEN_BACKUP_S3_ENDPOINT#https://}"; ep="${ep#http://}"
  local vol="/var/lib/docker/volumes/${BACKUPS_VOLUME}/_data"
  [ -d "$vol" ] || { fail "off-site: backups volume path missing: ${vol}"; return 0; }
  log "off-site mirror → s3://${BRIVEN_BACKUP_S3_BUCKET}/doltgres-backups/"
  if docker run --rm -v "${vol}:/backups:ro" \
        -e "MC_HOST_off=https://${BRIVEN_BACKUP_S3_ACCESS_KEY}:${BRIVEN_BACKUP_S3_SECRET_KEY}@${ep}" \
        --entrypoint sh minio/mc:latest \
        -c "mc mirror --overwrite --remove /backups off/${BRIVEN_BACKUP_S3_BUCKET}/doltgres-backups/" >/dev/null 2>&1; then
    log "off-site mirror ok"
  else
    fail "off-site mirror failed"
  fi
  if [ -d "$LOCAL_BACKUP_ROOT" ]; then
    docker run --rm -v "${LOCAL_BACKUP_ROOT}:/pgd:ro" \
      -e "MC_HOST_off=https://${BRIVEN_BACKUP_S3_ACCESS_KEY}:${BRIVEN_BACKUP_S3_SECRET_KEY}@${ep}" \
      --entrypoint sh minio/mc:latest \
      -c "mc mirror --overwrite /pgd off/${BRIVEN_BACKUP_S3_BUCKET}/pg-dumps/" >/dev/null 2>&1 \
      || fail "off-site mirror (pg dumps) failed"
  fi
}

prune_local() {
  [ -d "$LOCAL_BACKUP_ROOT" ] || return 0
  log "pruning local pg dumps older than ${LOCAL_RETENTION_DAYS}d"
  find "$LOCAL_BACKUP_ROOT" -type f -name '*.dump.gz' -mtime +"$LOCAL_RETENTION_DAYS" -delete || true
  find "$LOCAL_BACKUP_ROOT" -type d -empty -delete || true
}

log "briven backup run starting (doltgres=${DC}, throttle=${THROTTLE}s)"
dolt_backup_all      # primary DR
pg_dump_secondary    # secondary rollback
offsite_mirror       # off-site (if configured)
prune_local

if [ "$FAILURES" -gt 0 ]; then
  log "ERROR: ${FAILURES} failure(s): ${FAILURE_DETAIL}"
  { echo "failures=${FAILURES}"; echo "detail=${FAILURE_DETAIL}"; } > /run/briven-backup-status
  exit 1
fi
rm -f /run/briven-backup-status
log "briven backup run complete — all layers ok"
