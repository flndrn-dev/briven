#!/usr/bin/env bash
# Daily pg_dump of briven's two databases. Runs on the KVM via a systemd
# timer (see briven-backup.{service,timer}).
#
# Today's destination: local disk under /var/backups/briven/. Once
# B2/R2 credentials land, the upload step at the bottom is enabled by
# setting BRIVEN_BACKUP_S3_* env vars in /etc/briven/backup.env.
#
# What gets backed up (both live in the briven-postgres-1 container):
#   - briven_control  — meta-DB (users, orgs, projects, subscriptions, auth)
#   - briven_data     — customer schemas (schema-per-tenant)
#
# Local layout:
#   /var/backups/briven/<db-name>/<YYYY-MM-DD>/<hh-mm-ss>.dump.gz
#
# Off-site layout (when configured):
#   s3://${BRIVEN_BACKUP_S3_BUCKET}/<db-name>/<YYYY-MM-DD>/<hh-mm-ss>.dump.gz
#
# Retention: 30 days local; off-site lifecycle is handled by the bucket.

set -euo pipefail

# ─── config ────────────────────────────────────────────────────────────
PG_CONTAINER="briven-postgres-1"
PG_USER="postgres"
DBS=("briven_control" "briven_data")
LOCAL_BACKUP_ROOT="/var/backups/briven"
LOCAL_RETENTION_DAYS=30

# Optional config file with BRIVEN_BACKUP_S3_* — see below.
BACKUP_ENV_FILE="/etc/briven/backup.env"

STAMP="$(date -u +'%Y-%m-%d/%H-%M-%S')"

# ─── helpers ───────────────────────────────────────────────────────────
log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

# Optional off-site config. When unset, we just write to local disk —
# good enough for first weeks; the prune step still runs.
if [ -f "$BACKUP_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$BACKUP_ENV_FILE"
fi

# ─── dump per DB ──────────────────────────────────────────────────────
dump_one() {
  local db_name="$1"
  local local_dir="${LOCAL_BACKUP_ROOT}/${db_name}/${STAMP%/*}"
  local local_file="${local_dir}/${STAMP##*/}.dump.gz"

  mkdir -p "$local_dir"

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

  # ─── optional off-site upload ───────────────────────────────────────
  if [ -n "${BRIVEN_BACKUP_S3_ENDPOINT:-}" ] \
     && [ -n "${BRIVEN_BACKUP_S3_BUCKET:-}" ] \
     && [ -n "${BRIVEN_BACKUP_S3_ACCESS_KEY:-}" ] \
     && [ -n "${BRIVEN_BACKUP_S3_SECRET_KEY:-}" ]; then
    local object="s3://${BRIVEN_BACKUP_S3_BUCKET}/${db_name}/${STAMP}.dump.gz"
    log "uploading ${object}"
    if ! docker run --rm \
          -v "${local_file}:/backup.dump.gz:ro" \
          --entrypoint sh \
          minio/mc:latest \
          -c "mc alias set off ${BRIVEN_BACKUP_S3_ENDPOINT} ${BRIVEN_BACKUP_S3_ACCESS_KEY} ${BRIVEN_BACKUP_S3_SECRET_KEY} > /dev/null \
              && mc cp /backup.dump.gz off/${BRIVEN_BACKUP_S3_BUCKET}/${db_name}/${STAMP}.dump.gz"; then
      log "WARN: off-site upload failed for ${db_name} — local copy still safe"
    else
      log "off-site upload ok"
    fi
  else
    log "off-site upload skipped (BRIVEN_BACKUP_S3_* unset)"
  fi
}

# ─── prune old local backups ───────────────────────────────────────────
prune_local() {
  log "pruning local dumps older than ${LOCAL_RETENTION_DAYS}d"
  if [ -d "$LOCAL_BACKUP_ROOT" ]; then
    find "$LOCAL_BACKUP_ROOT" -type f -name '*.dump.gz' -mtime +"$LOCAL_RETENTION_DAYS" -delete || true
    # Tidy empty directories left by the find above.
    find "$LOCAL_BACKUP_ROOT" -type d -empty -delete || true
  fi
}

# ─── run ───────────────────────────────────────────────────────────────
log "briven backup run starting"

for db in "${DBS[@]}"; do
  dump_one "$db"
done

prune_local

log "briven backup run complete"
