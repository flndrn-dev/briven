# briven — backup restore runbook

All backups are `pg_dump --format=custom` files uploaded nightly by
`pg-dump.sh` to `b2://$BRIVEN_BACKUP_B2_BUCKET/<prefix>/<YYYYMMDD-HHMMSS>/`.
Each timestamped directory contains:

- `control.dump` — briven control-plane meta-DB (`briven_control`)
- `data.dump`    — shared data-plane cluster (`briven_data`, all project schemas)
- `sha256sums.txt` — content hashes for integrity verification

## restore

From a fresh Postgres 17 cluster. Run these against a **staging database** first —
production restore must follow the standard "full drill once a month" cadence
(see `CLAUDE.md §5.5`).

```sh
# 0. download + verify the target snapshot
export B2_APPLICATION_KEY_ID=...
export B2_APPLICATION_KEY=...
b2 sync "b2://briven-backups/prod/20260501-030000" ./restore
cd restore && sha256sum -c sha256sums.txt

# 1. restore the control-plane meta-DB
pg_restore --clean --if-exists --no-owner --dbname "$CONTROL_URL" control.dump

# 2. restore the data plane (all project schemas + their _briven_migrations)
pg_restore --clean --if-exists --no-owner --dbname "$DATA_URL" data.dump

# 3. run drizzle migrations to reconcile any schema drift vs. live code
cd /app/apps/api && pnpm db:migrate
```

## monthly drill

Drill date (first Monday, ~30 minutes):

1. spin up a Dokploy preview Postgres, restore yesterday's dump into it
2. point a staging `briven-api` at the restored control DB
3. run: sign in, create a project, deploy the hello-world template, invoke
4. write a short log in `docs/runbooks/restore-drills.md` — date, RTO, issues

## retention

Set a B2 bucket lifecycle rule, not code-side deletion, so the
dev does not accidentally remove old snapshots. Recommended phases:

- 0–30 days:   keep every nightly
- 30–365 days: weekly only (B2 lifecycle: "keep one per 7 days")
- >1 year:     delete

## what's NOT backed up yet

- function bundles (stored in the api's `bundle jsonb` column, so they ride
  along with `control.dump`)
- Better Auth sessions (ephemeral, 30-day TTL, acceptable to lose on restore)
- Resend email deliverability history (lives at Resend, not ours)

When bundles migrate to object storage (Phase 3), add a second sync:
`b2 sync --delete ./bundles b2://briven-backups/<prefix>/<ts>/bundles`.
