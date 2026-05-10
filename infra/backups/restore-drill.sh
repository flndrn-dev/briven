#!/bin/sh
# briven — restore drill. pulls the most recent backup off-site, restores
# it into a throwaway postgres database, runs sanity counts, then drops
# everything. intended to run monthly on the same kvm that takes the
# nightly backup so we never discover at 3am that a backup is unusable.
#
# the drill exercises the full path: download → checksum → restore →
# query → drop. failure on ANY step exits non-zero so the cron's discord
# webhook fires.
#
# required env:
#   BRIVEN_BACKUP_B2_KEY_ID
#   BRIVEN_BACKUP_B2_APP_KEY
#   BRIVEN_BACKUP_B2_BUCKET
#   BRIVEN_DRILL_PG_HOST          — host running a restore-only postgres
#   BRIVEN_DRILL_PG_PORT          — default 5432
#   BRIVEN_DRILL_PG_USER          — superuser that can CREATE/DROP DATABASE
#   BRIVEN_DRILL_PG_PASSWORD
#
# optional env:
#   BRIVEN_BACKUP_PREFIX          — default: prod
#
# the script picks the lexicographically-latest dated folder under the
# prefix, which works because pg-dump.sh names folders with the timestamp.

set -eu

prefix=${BRIVEN_BACKUP_PREFIX:-prod}
ts=$(date -u +%Y%m%d-%H%M%S)
work=/tmp/briven-restore-drill-$ts
trap 'rm -rf "$work"' EXIT

mkdir -p "$work"

export B2_APPLICATION_KEY_ID="$BRIVEN_BACKUP_B2_KEY_ID"
export B2_APPLICATION_KEY="$BRIVEN_BACKUP_B2_APP_KEY"

echo "[restore-drill $ts] picking latest backup folder"
latest=$(b2 ls "$BRIVEN_BACKUP_B2_BUCKET/$prefix/" --json \
  | jq -r '.[].fileName' \
  | sed 's|/$||' \
  | sort \
  | tail -n 1)
if [ -z "$latest" ]; then
  echo "[restore-drill $ts] no backups under prefix=$prefix — drill cannot proceed" >&2
  exit 1
fi
echo "[restore-drill $ts] latest=$latest"

echo "[restore-drill $ts] downloading"
b2 sync "b2://$BRIVEN_BACKUP_B2_BUCKET/$latest" "$work"

echo "[restore-drill $ts] checksum verify"
( cd "$work" && sha256sum -c sha256sums.txt ) || {
  echo "[restore-drill $ts] checksum mismatch — refusing to restore" >&2
  exit 2
}

restore_db="briven_drill_$(date -u +%s)"
export PGHOST="$BRIVEN_DRILL_PG_HOST"
export PGPORT="${BRIVEN_DRILL_PG_PORT:-5432}"
export PGUSER="$BRIVEN_DRILL_PG_USER"
export PGPASSWORD="$BRIVEN_DRILL_PG_PASSWORD"

echo "[restore-drill $ts] CREATE DATABASE $restore_db"
psql -d postgres -c "CREATE DATABASE $restore_db" >/dev/null

# Trap the drop so a partial restore still cleans up.
trap '
  rm -rf "$work";
  psql -d postgres -c "DROP DATABASE IF EXISTS $restore_db" >/dev/null 2>&1 || true
' EXIT

echo "[restore-drill $ts] restoring control.dump → $restore_db"
pg_restore --no-owner --no-privileges --dbname="$restore_db" "$work/control.dump"

echo "[restore-drill $ts] sanity counts on the meta-db"
# These tables exist on every shipped revision of the control schema. If
# any of them are zero, the dump didn't capture the rows we expect —
# fail the drill loudly so j gets paged.
fail=0
for t in users projects deployments organizations subscriptions; do
  n=$(psql -d "$restore_db" -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo "ERROR")
  echo "[restore-drill $ts]   $t = $n"
  if [ "$n" = "ERROR" ]; then
    echo "[restore-drill $ts]   $t MISSING — drill failed" >&2
    fail=1
  fi
done

echo "[restore-drill $ts] restoring data.dump → $restore_db"
pg_restore --no-owner --no-privileges --dbname="$restore_db" "$work/data.dump"

# At least one project schema must be present in the data dump (else
# we restored an empty cluster and the drill is meaningless).
schemas=$(psql -d "$restore_db" -tAc \
  "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'proj_%'")
echo "[restore-drill $ts] data-plane project schemas restored: $schemas"
if [ "$schemas" -lt 1 ]; then
  echo "[restore-drill $ts] no proj_* schemas — drill failed" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "[restore-drill $ts] FAILED" >&2
  exit 3
fi

echo "[restore-drill $ts] OK — backup taken at $latest restores cleanly"
