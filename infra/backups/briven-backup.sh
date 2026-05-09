#!/usr/bin/env bash
# Daily pg_dump of briven's two control-plane-adjacent databases to
# object storage. Runs on the KVM via a systemd timer (see
# briven-backup.{service,timer}).
#
# Today's destination: local MinIO on the same KVM (`briven-minio`
# service on dokploy-network). Phase 0 exit criterion requires
# off-site (R2 / B2 / cross-region) — that's a follow-up swap; point
# this script at a different `mc alias` once credentials land.
#
# What gets backed up:
#   - briven_control  (meta-DB: users, orgs, projects, subscriptions, auth tables)
#   - briven_data     (customer schemas — schema-per-tenant)
#
# Output format:
#   s3://briven-backups/<db-name>/<YYYY-MM-DD>/<hh-mm-ss>.dump.gz
#   The date prefix lets lifecycle rules prune by age.
#
# Exit codes:
#   0  both dumps uploaded successfully
#   1+ at least one step failed — see logs

set -euo pipefail

# ─── config ────────────────────────────────────────────────────────────
# Dokploy-managed swarm service names (resolvable inside dokploy-network).
PG_CONTROL_SERVICE="postgres-quantify-virtual-pixel-2q7jlc"
PG_DATA_SERVICE="postgres-calculate-primary-array-iykeiy"
PG_USER="briven"

# MinIO alias config.
MINIO_ENDPOINT="http://briven-minio:9000"
MINIO_ACCESS_KEY="briven"
# Password comes from /etc/briven/backup.env — NOT baked into the script.
# See the systemd unit; Dokploy's MinIO root password is what gets written there.
MINIO_SECRET_KEY_FILE="/etc/briven/backup.env"

BUCKET="briven-backups"
STAMP="$(date -u +'%Y-%m-%d/%H-%M-%S')"

# ─── helpers ───────────────────────────────────────────────────────────
log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

# Load MINIO_SECRET_KEY from the env file. The file has lines like
# MINIO_SECRET_KEY=<value> and is chmod 600 root:root.
[ -f "$MINIO_SECRET_KEY_FILE" ] || die "$MINIO_SECRET_KEY_FILE missing"
# shellcheck disable=SC1090
source "$MINIO_SECRET_KEY_FILE"
[ -n "${MINIO_SECRET_KEY:-}" ] || die "MINIO_SECRET_KEY not set in $MINIO_SECRET_KEY_FILE"

# ─── dump + upload per DB ──────────────────────────────────────────────
dump_and_upload() {
  local db_name="$1"
  local pg_service="$2"
  local pg_container
  pg_container="$(docker ps -q --filter "label=com.docker.swarm.service.name=${pg_service}" | head -1)"
  [ -n "$pg_container" ] || die "no running container for pg service ${pg_service}"

  local tmp="/tmp/briven-backup-${db_name}-$$.dump.gz"
  log "dumping ${db_name} (pg container: ${pg_container:0:12})"

  # pg_dump --format=custom streams a binary dump; pipe through gzip then
  # straight to disk. --format=custom is restorable via pg_restore with
  # granular options (selective table restore, parallel, etc.).
  if ! docker exec "$pg_container" pg_dump \
        --username="$PG_USER" \
        --format=custom \
        --compress=0 \
        --no-owner --no-privileges \
        "$db_name" \
        | gzip -9 > "$tmp"; then
    rm -f "$tmp"
    die "pg_dump failed for ${db_name}"
  fi

  local size
  size="$(stat -c%s "$tmp")"
  log "dump ok: ${size} bytes"

  # Use a one-shot mc container on the swarm overlay to push the dump.
  # --rm so it cleans up; mount the tmp file read-only.
  local object="s3://${BUCKET}/${db_name}/${STAMP}.dump.gz"
  log "uploading to ${object}"

  if ! docker run --rm \
        --network dokploy-network \
        -v "${tmp}:/backup.dump.gz:ro" \
        --entrypoint sh \
        minio/mc:latest \
        -c "mc alias set bm ${MINIO_ENDPOINT} ${MINIO_ACCESS_KEY} ${MINIO_SECRET_KEY} > /dev/null \
            && mc cp /backup.dump.gz bm/${BUCKET}/${db_name}/${STAMP}.dump.gz"; then
    rm -f "$tmp"
    die "mc upload failed for ${db_name}"
  fi

  rm -f "$tmp"
  log "uploaded ${db_name} backup"
}

# ─── run ───────────────────────────────────────────────────────────────
log "briven backup run starting"

dump_and_upload "briven_control" "$PG_CONTROL_SERVICE"
dump_and_upload "briven_data"    "$PG_DATA_SERVICE"

log "briven backup run complete"
