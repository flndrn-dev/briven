# `infra/datapane/RESTORE.md`

briven data-plane disaster recovery — Phase 9 of `BACKEND_FORK_BRIEF.md`.

## What this file covers

How to restore the briven data-plane Postgres from pgBackRest backups in Cloudflare R2 onto a fresh VPS in under 15 minutes. Use this when the live cluster is unrecoverable (disk dead, accidental `DROP DATABASE`, ransomware, etc.).

## Pre-reqs

The fresh host needs:

- Docker + Docker Compose v2
- Outbound network to `${BRIVEN_BACKUP_R2_ENDPOINT}`
- The `.env` from production with `BRIVEN_BACKUP_*` and `BRIVEN_POSTGRES_PASSWORD` populated (recover from password manager — pgBackRest cipher key + Postgres password must match the cluster being restored)

## Recovery time objective

| step | budget |
|---|---|
| boot fresh VPS | 3 min |
| pull docker images | 3 min |
| pgBackRest restore | 5 min (depends on data size; ~1GB/min from R2) |
| run init scripts + start services | 3 min |
| DNS cutover (if hostname change) | 1 min |
| **total** | **~15 min** |

RPO is 15 min (incremental backup cadence per `pgbackrest/crontab`). Last 15 min of writes can be lost.

## Procedure

### 1. Provision the host

```bash
ssh root@new-host
git clone https://codeberg.org/flndrn/briven.git /opt/briven
cd /opt/briven/infra/datapane
cp .env.example .env
# paste real values from password manager:
#   BRIVEN_POSTGRES_PASSWORD
#   BRIVEN_JWT_SECRET
#   BRIVEN_REALTIME_ENC_KEY
#   BRIVEN_REALTIME_SECRET_KEY_BASE
#   BRIVEN_BACKUP_R2_BUCKET
#   BRIVEN_BACKUP_R2_ENDPOINT
#   BRIVEN_BACKUP_R2_ACCESS_KEY
#   BRIVEN_BACKUP_R2_SECRET_KEY
#   BRIVEN_BACKUP_ENCRYPTION_KEY
nano .env
```

### 2. Pull images (parallelize)

```bash
docker compose pull
```

### 3. Restore Postgres from R2 (DO NOT start db first)

```bash
# Run pgbackrest restore against an empty PGDATA volume. The db service
# is NOT started here — pgBackRest needs to write into an empty
# /var/lib/postgresql/data and that conflicts with a running Postgres.

docker volume create briven-db-data

docker run --rm \
  --env-file .env \
  -v briven-db-data:/var/lib/postgresql/data \
  -v "$(pwd)/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro" \
  pgbackrest/pgbackrest:2.55.1 \
  pgbackrest \
    --stanza=briven \
    --log-level-console=info \
    --delta \
    restore
```

**Point-in-time recovery** (restore to a specific timestamp instead of latest):

```bash
docker run --rm ... pgbackrest/pgbackrest:2.55.1 \
  pgbackrest \
    --stanza=briven \
    --type=time \
    --target='2026-05-21 14:00:00+00' \
    restore
```

### 4. Start the stack

```bash
docker compose up -d
docker compose ps
docker compose logs -f db | grep -i 'ready\|error'
```

Watch for `database system is ready to accept connections`. If you see WAL replay errors, fall back to step 3 with `--type=immediate` (skip WAL after restore) and accept the older RPO.

### 5. Verify

```bash
# Reach REST through Caddy:
curl -sI http://localhost:8000/rest/v1/
# Should respond 200 with Server: briven (no postgrest, no supabase, no kong).

# Confirm pgBackRest sees the stanza:
docker compose exec pgbackrest pgbackrest --stanza=briven info

# Check that incremental backups resume:
docker compose logs pgbackrest --tail=20
# Expect "P00 INFO: backup command end: completed successfully" within 15 min.
```

### 6. DNS cutover

Update the `api.briven.tech` A/AAAA records in Cloudflare to point at the new host's public IP. TTL is 60s; cutover propagates within a minute.

## Drill — when to test this

- **Quarterly**: J spins up a throwaway VPS, runs steps 1-5, confirms `pgbackrest info` returns the latest backup, then destroys the VPS. Document outcome in `docs/runbooks/backup-drill-YYYY-QN.md`.
- **After every pgBackRest version bump**: rerun a partial restore (single database, not full cluster) to verify the new binary reads existing backups.
- **Before any production schema migration**: trigger a manual full backup before applying:

  ```bash
  docker compose exec pgbackrest pgbackrest --stanza=briven --type=full backup
  ```

## When restore fails

| symptom | cause | fix |
|---|---|---|
| `ERROR: [055]: invalid backup ... stop time` | wrong cipher key — `BRIVEN_BACKUP_ENCRYPTION_KEY` doesn't match the value used at backup time | recover correct key from password manager; rerun |
| `ERROR: [104]: no backups exist for stanza 'briven'` | empty R2 bucket or wrong `BRIVEN_BACKUP_R2_BUCKET` | check bucket name + R2 console; if empty, the cluster was never backed up — there is no recovery |
| Postgres starts but is in recovery mode forever | WAL replay stuck on a missing segment | restore with `--type=immediate`; accept stale RPO |
| `pgbackrest check` fails with `archive command not configured` | db service hasn't been configured to push WAL — see `volumes/db/jwt.sql` or extend with an `archive_command` ALTER SYSTEM | configure `archive_command = 'pgbackrest --stanza=briven archive-push %p'` |

## Anti-patterns (do not do these)

- **No `--delta` skip on `restore`** when the volume is non-empty. Without `--delta`, restore refuses to overwrite. With `--delta` it does incremental file replacement — much faster on partial corruption.
- **Don't mount the running PGDATA into pgbackrest at restore time**. Postgres holds locks; restore will fail. Stop db service first or use a separate volume.
- **Don't run `pgbackrest stanza-create` against an existing stanza in R2 without `--force`** — it will refuse, but if you force it, it'll wipe the remote stanza metadata. Only run stanza-create on a fresh setup.
- **Don't trust a backup until you've tested restore**. The quarterly drill is the test.

## Cross-references

- `infra/datapane/compose.yml` — `pgbackrest` service definition
- `infra/datapane/pgbackrest/pgbackrest.conf` — stanza config
- `infra/datapane/pgbackrest/crontab` — backup schedule
- `infra/datapane/.env.example` — `BRIVEN_BACKUP_*` env vars
- `BACKEND_FORK_BRIEF.md` §5 Phase 9 — original spec
