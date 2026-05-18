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

# Tally of off-site upload failures across all DBs in this run. Read by
# the trailing failure-detection block; exported to /run/briven-backup-status
# so briven-backup-alert.service can name the failing DBs in Discord.
UPLOAD_FAILURES=0
UPLOAD_FAILURE_DBS=""

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
    # Credentials are passed via env (-e), not as positional args, so they
    # never appear in `docker inspect` / `ps -ef`. mc reads MC_HOST_<alias>
    # in URL form: https://KEY:SECRET@host. See
    # docs/superpowers/findings/2026-04-25-security-and-structural-review.md:177.
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

if [ "$UPLOAD_FAILURES" -gt 0 ]; then
  # Surface the failure detail in journal AND exit non-zero so systemd's
  # OnFailure= unit (briven-backup-alert.service) fires. Local dump is
  # safe — only the remote mirror missed. Next run will overwrite the
  # same off-site key; no manual cleanup needed.
  log "ERROR: ${UPLOAD_FAILURES} off-site upload(s) failed (dbs=${UPLOAD_FAILURE_DBS})"
  log "briven backup run complete with upload failures — exiting non-zero"
  # Export for the OnFailure unit; systemd preserves env via FailureActionExitStatus.
  echo "upload_failures=${UPLOAD_FAILURES}" > /run/briven-backup-status
  echo "upload_failure_dbs=${UPLOAD_FAILURE_DBS}" >> /run/briven-backup-status
  exit 1
fi

log "briven backup run complete"
