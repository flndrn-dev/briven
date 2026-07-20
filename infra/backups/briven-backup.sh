#!/usr/bin/env bash
# Daily backup of briven control plane (+ optional off-site mirror).
# Runs on the France host via systemd (briven-backup.{service,timer}).
#
# Topology (2026-07-21): Briven is Doltgres end-to-end.
#   - Control + data plane: DoltGres (briven_control + proj_* databases).
#   - dolt-backup sidecar runs native dolt_backup for ALL databases including
#     briven_control. This host script is a transitional dump helper for
#     stock Postgres rollback windows only — prefer dolt_backup + off-site
#     mirror of the doltgres_backups volume for real DR.
#
# Env (optional, /etc/briven/backup.env):
#   BRIVEN_BACKUP_PG_CONTAINER   default: briven-brivenfrance-uilsk6-postgres-1
#   BRIVEN_BACKUP_PG_USER        default: postgres
#   BRIVEN_BACKUP_DBS            space-separated; default: briven_control
#   BRIVEN_BACKUP_S3_ENDPOINT    if set with bucket+keys → off-site upload
#   BRIVEN_BACKUP_S3_BUCKET
#   BRIVEN_BACKUP_S3_ACCESS_KEY
#   BRIVEN_BACKUP_S3_SECRET_KEY
#
# Local layout:
#   /var/backups/briven/<db-name>/<YYYY-MM-DD>/<hh-mm-ss>.dump.gz
#
# Exit 1 if any off-site upload fails (local dump still kept) so
# OnFailure=briven-backup-alert.service can fire.

set -euo pipefail

BACKUP_ENV_FILE="/etc/briven/backup.env"
if [ -f "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
fi

PG_CONTAINER="${BRIVEN_BACKUP_PG_CONTAINER:-briven-brivenfrance-uilsk6-postgres-1}"
PG_USER="${BRIVEN_BACKUP_PG_USER:-postgres}"
# shellcheck disable=SC2206
DBS=(${BRIVEN_BACKUP_DBS:-briven_control})
LOCAL_BACKUP_ROOT="/var/backups/briven"
LOCAL_RETENTION_DAYS="${BRIVEN_BACKUP_LOCAL_RETENTION_DAYS:-30}"

STAMP="$(date -u +'%Y-%m-%d/%H-%M-%S')"
UPLOAD_FAILURES=0
UPLOAD_FAILURE_DBS=""

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

dump_one() {
  local db_name="$1"
  local local_dir="${LOCAL_BACKUP_ROOT}/${db_name}/${STAMP%/*}"
  local local_file="${local_dir}/${STAMP##*/}.dump.gz"

  mkdir -p "$local_dir"

  if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    die "postgres container not found: ${PG_CONTAINER}"
  fi

  log "dumping ${db_name} from ${PG_CONTAINER}"
  if ! docker exec "$PG_CONTAINER" pg_dump \
        --username="$PG_USER" \
        --format=custom \
        --compress=0 \
        --no-owner --no-privileges \
        "$db_name" \
        | gzip -9 > "$local_file"; then
    rm -f "$local_file"
    die "pg_dump failed for ${db_name}"
  fi

  local size
  size="$(stat -c%s "$local_file")"
  log "ok ${db_name}: ${size} bytes → ${local_file}"

  # Optional off-site (B2/R2 S3-compatible via minio/mc).
  if [ -n "${BRIVEN_BACKUP_S3_ENDPOINT:-}" ] \
     && [ -n "${BRIVEN_BACKUP_S3_BUCKET:-}" ] \
     && [ -n "${BRIVEN_BACKUP_S3_ACCESS_KEY:-}" ] \
     && [ -n "${BRIVEN_BACKUP_S3_SECRET_KEY:-}" ]; then
    local object="s3://${BRIVEN_BACKUP_S3_BUCKET}/${db_name}/${STAMP}.dump.gz"
    log "uploading ${object}"
    local endpoint_no_scheme="${BRIVEN_BACKUP_S3_ENDPOINT#https://}"
    endpoint_no_scheme="${endpoint_no_scheme#http://}"
    if ! docker run --rm \
          -v "${local_file}:/backup.dump.gz:ro" \
          -e "MC_HOST_off=https://${BRIVEN_BACKUP_S3_ACCESS_KEY}:${BRIVEN_BACKUP_S3_SECRET_KEY}@${endpoint_no_scheme}" \
          --entrypoint sh \
          minio/mc:latest \
          -c "mc cp /backup.dump.gz off/${BRIVEN_BACKUP_S3_BUCKET}/${db_name}/${STAMP}.dump.gz"; then
      log "WARN: off-site upload failed for ${db_name} — local copy still safe"
      UPLOAD_FAILURES=$((UPLOAD_FAILURES + 1))
      UPLOAD_FAILURE_DBS="${UPLOAD_FAILURE_DBS:+${UPLOAD_FAILURE_DBS} }${db_name}"
    else
      log "off-site upload ok"
    fi
  else
    log "off-site upload skipped (BRIVEN_BACKUP_S3_* unset) — Phase 0.1 still Not done"
  fi
}

prune_local() {
  log "pruning local dumps older than ${LOCAL_RETENTION_DAYS}d"
  if [ -d "$LOCAL_BACKUP_ROOT" ]; then
    find "$LOCAL_BACKUP_ROOT" -type f -name '*.dump.gz' -mtime +"$LOCAL_RETENTION_DAYS" -delete || true
    find "$LOCAL_BACKUP_ROOT" -type d -empty -delete || true
  fi
}

log "briven backup run starting (container=${PG_CONTAINER} dbs=${DBS[*]})"

for db in "${DBS[@]}"; do
  dump_one "$db"
done

prune_local

if [ "$UPLOAD_FAILURES" -gt 0 ]; then
  log "ERROR: ${UPLOAD_FAILURES} off-site upload(s) failed (dbs=${UPLOAD_FAILURE_DBS})"
  echo "upload_failures=${UPLOAD_FAILURES}" > /run/briven-backup-status
  echo "upload_failure_dbs=${UPLOAD_FAILURE_DBS}" >> /run/briven-backup-status
  exit 1
fi

# Clear stale status on success
rm -f /run/briven-backup-status
log "briven backup run complete"
