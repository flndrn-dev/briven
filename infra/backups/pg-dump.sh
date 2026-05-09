#!/bin/sh
# briven — nightly pg_dump of every data-plane project schema + control meta-DB
# intended to run as a Dokploy cron (or plain host crontab) on the KVM that
# hosts the postgres containers.
#
# required env:
#   BRIVEN_BACKUP_B2_KEY_ID       — Backblaze B2 application key id
#   BRIVEN_BACKUP_B2_APP_KEY      — Backblaze B2 application key secret
#   BRIVEN_BACKUP_B2_BUCKET       — target bucket name (e.g. briven-backups)
#   BRIVEN_BACKUP_CONTROL_URL     — postgres://… for briven_control
#   BRIVEN_BACKUP_DATA_URL        — postgres://… for briven_data
#
# optional env:
#   BRIVEN_BACKUP_PREFIX          — key prefix inside the bucket (default: prod/)
#   BRIVEN_BACKUP_RETENTION_DAYS  — not enforced here; set a bucket lifecycle
#                                    rule instead (kept as a doc hint).
#
# restore is documented in infra/backups/RESTORE.md

set -eu

ts=$(date -u +%Y%m%d-%H%M%S)
prefix=${BRIVEN_BACKUP_PREFIX:-prod}
tmp=/tmp/briven-backup-$ts
mkdir -p "$tmp"

echo "[briven-backup $ts] control-plane pg_dump"
pg_dump --format=custom --compress=6 --file "$tmp/control.dump" \
  "$BRIVEN_BACKUP_CONTROL_URL"

echo "[briven-backup $ts] data-plane pg_dump (all schemas)"
pg_dump --format=custom --compress=6 --file "$tmp/data.dump" \
  "$BRIVEN_BACKUP_DATA_URL"

# Optional SHA256 manifest — cheap integrity check at restore time.
( cd "$tmp" && sha256sum *.dump > sha256sums.txt )

echo "[briven-backup $ts] uploading to b2://$BRIVEN_BACKUP_B2_BUCKET/$prefix/$ts/"
export B2_APPLICATION_KEY_ID="$BRIVEN_BACKUP_B2_KEY_ID"
export B2_APPLICATION_KEY="$BRIVEN_BACKUP_B2_APP_KEY"
b2 sync --delete "$tmp" "b2://$BRIVEN_BACKUP_B2_BUCKET/$prefix/$ts"

rm -rf "$tmp"
echo "[briven-backup $ts] done"
