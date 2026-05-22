#!/bin/sh
# briven pgBackRest entrypoint — Phase 9 of BACKEND_FORK_BRIEF.md.
#
# What this does (in order):
#   1. Ensure work dirs exist (idempotent).
#   2. Run `stanza-create` if the repo has no stanza yet (idempotent —
#      pgbackrest will refuse if a stanza exists with mismatched config).
#   3. Take an initial full backup if none exists, so the first cron `incr`
#      has a parent.
#   4. Exec crond in foreground (busybox crond, reading /etc/crontabs/root)
#      so the container stays alive and runs the schedule from
#      pgbackrest/crontab.
#
# What this does NOT do — known gap tracked in HANDOFF.md:
#   - Does not set Postgres `archive_command`. That requires the pgbackrest
#     binary inside the db container, which is not present in
#     supabase/postgres:15.8.1.085. Without archive_command, RPO degrades
#     from "last WAL push" (seconds) to "last cron run" (15 min). To close:
#     build a custom db image (supabase/postgres + apk add pgbackrest +
#     archive.sql init script that runs `ALTER SYSTEM SET archive_command`).
#     Do not build on the deploy host — see docs/DOCKER.md rule 5.

set -eu

STANZA=briven
LOG="[briven-pgbackrest]"

mkdir -p /var/log/pgbackrest /var/lib/pgbackrest/spool /var/lib/pgbackrest/lock

if pgbackrest --stanza="$STANZA" info >/dev/null 2>&1; then
  echo "$LOG stanza '$STANZA' already exists in repo"
else
  echo "$LOG creating stanza '$STANZA'"
  pgbackrest --stanza="$STANZA" stanza-create
fi

if pgbackrest --stanza="$STANZA" info --output=json 2>/dev/null | grep -q '"type":"full"'; then
  echo "$LOG existing full backup found"
else
  echo "$LOG no full backup yet; taking initial full (this may take several minutes)"
  pgbackrest --stanza="$STANZA" --type=full backup || \
    echo "$LOG WARNING: initial full failed; cron nightly full will retry"
fi

echo "$LOG starting crond (schedule from /etc/crontabs/root)"
exec crond -f -L /dev/stdout
