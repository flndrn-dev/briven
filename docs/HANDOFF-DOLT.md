## Session handoff — briven → Dolt migration

You are continuing a multi-session architecture + planning thread for migrating briven's database platform from PostgreSQL 17 to Dolt (https://github.com/dolthub/dolt). The decision is locked. Phase 0 is done. Here is the full state.

### Decision

briven migrates from PostgreSQL 17 to **Dolt MySQL-compatible mode** (not DoltgreSQL — alpha). mavi-pay (Stripe-based) is the billing provider. All 6 platform features survive:

- Realtime: LISTEN/NOTIFY → Dolt commit-diff polling (500ms, configurable to 100ms)
- Auth: Better Auth via drizzle mysql-core adapter (unchanged at API level)
- Storage: MinIO S3-compatible (zero change)
- Edge functions: Deno isolates, query builder emits MySQL dialect, same `ctx.db()` API
- AI features: External APIs (Ollama, OpenAI) — zero database dependency
- Payments: mavi-pay as `BillingProvider` (ARCHITECTURE.md §7), 3 Dolt-native meters: branches, commits, time-travel retention

### What's done

- **ADR written:** `docs/ADR/0001-dolt-migration.md` — 8 sub-decisions with rationale, consequences, rejected alternatives
- **Dolt vs InsForge comparison:** InsForge rejected (commodity Postgres, competes with briven directly)
- **Full 11-phase plan** scoped and estimated (4–6 months, ~100 files)

### 11-phase plan (Phase 0 done, 1–11 pending)

| # | Phase | Status |
|---|---|---|
| 0 | ADR + architecture decisions | **done** |
| 1 | Database engine swap: mysql2 driver, drizzle mysql-core, tenant isolation (database-per-project) | **done** |
| 2 | Realtime: commit-diff polling, PollManager, trigger removal | pending |
| 3 | Auth: Better Auth mysql-core adapter | pending |
| 4 | Storage: MinIO (unchanged) | pending |
| 5 | Edge functions: MySQL query builder, LanceDB vectors | pending |
| 6 | AI: unchanged | pending |
| 7 | Payments: mavi-pay BillingProvider, Dolt-native meters | pending |
| 8 | Infrastructure: Dolt compose, dolt backup, mysqld_exporter | pending |
| 9 | Website rebrand: 7-pillar feature grid, pricing, copy | pending |
| 10 | Dolt-native features: branching UX, time-travel, DoltHub | pending |
| 11 | Testing, CLI, cutover runbook | pending |

### Key architectural decisions (from ADR)

- **Driver:** `mysql2/promise` replaces `postgres` (postgres.js) across api, runtime, realtime
- **ORM:** `drizzle-orm/mysql-core` replaces `pg-core` for control-plane schema (`apps/api/src/db/schema.ts`, 1171 lines)
- **Tenant isolation:** `CREATE DATABASE proj_<id>` per project, `USE proj_<id>` instead of `SET LOCAL search_path`
- **Vector search:** LanceDB embedded replaces pgvector, `ctx.db.vectorSearch()` API unchanged
- **Extensions:** pg_cron→node-cron dispatcher, pgmq→Redis streams
- **Infrastructure:** single `BRIVEN_DOLT_URL=mysql://...` env var replaces two Postgres URLs
- **Billing:** mavi-pay meters branch count via `dolt_branches`, commit volume via `dolt_log`, time-travel via config flag

### Pricing ladder (Dolt-native levers in bold)

| | Free | Pro ($29/mo) | Team ($99/mo) |
|---|---|---|---|
| **Dolt branches** | 1 | 3 | ∞ |
| **Time-travel** | 24h | 30d | 1y |
| **Commits/mo** | 10k | 1M | ∞ |
| Realtime subs | 10 | 100 | 500 |
| Auth users | 1k | 50k | ∞ |
| Storage | 1 GB | 50 GB | 500 GB |
| Functions | 100k inv | 1M inv | 10M inv |
| AI tokens | 10k | 100k | 500k |
| Vector rows | 10k | 500k | 5M |

### Phase 1 complete (2026-06-06)

**~25 files changed across 3 services:**

- **`apps/api/src/db/schema.ts`** (1146 lines) — pg-core → mysql-core, 30+ tables, `text` PK → `varchar(36)`, `timestamptz` → `timestamp(3)`, `jsonb` → `json`, partial unique indexes dropped (application-level enforcement). All `@README-DOLT` markers on affected indexes.
- **`apps/api/src/db/client.ts`** — postgres-js → mysql2 pool (`drizzle-orm/mysql2`), `BRIVEN_DATABASE_URL` → `BRIVEN_DOLT_URL`
- **`apps/api/src/db/auth-customer-schema.ts`** — pg-core → mysql-core, `citext` → `utf8mb4_unicode_ci` collation
- **`apps/api/src/db/data-plane.ts`** — `CREATE SCHEMA` → `CREATE DATABASE`, `SET search_path` → `USE database` (per-connection), pg_roles → MySQL users, `$1` → `?` placeholders
- **`apps/api/drizzle.config.ts`** — `dialect: 'postgresql'` → `dialect: 'mysql'`
- **`apps/api/src/services/auth-tenant-pool.ts`** — `connection.search_path` → `database` pool option, `provider: 'pg'` → `provider: 'mysql'`
- **`apps/api/src/services/db-shell.ts`** — DSN generation for `mysql` client (not `psql`)
- **`apps/api/src/routes/health.ts`** — merged control + data plane checks into single `dolt` check
- **`apps/api/src/routes/auth-service.ts`** — `BRIVEN_DATA_PLANE_URL` → `BRIVEN_DOLT_URL`
- **5 workers** (`account-deletion-gc`, `outbound-webhook-dispatcher`, `polar-meter-push`, `schedule-dispatcher`, `storage-janitor`, `usage-aggregator`) — env var check updated
- **4 test files** — `BRIVEN_DATABASE_URL` → `BRIVEN_DOLT_URL`, placeholder URLs updated
- **`apps/api/src/env.ts`** — single `BRIVEN_DOLT_URL` replaces both `BRIVEN_DATABASE_URL` and `BRIVEN_DATA_PLANE_URL`
- **`apps/runtime/src/db.ts`** — postgres → mysql2, `search_path` → `USE database`, transaction API
- **`apps/runtime/src/query-builder.ts`** — `postgres.TransactionSql` → `PoolConnection`, `"..."` → `` `...` ``, `$N` → `?`, `RETURNING` removed (Phase 5 gap), vector search throws (Phase 5 gap)
- **`apps/runtime/src/index.ts`** — health probe uses `mysql2/promise`
- **`apps/runtime/src/runtime-bootstrap.ts`** — `tx.unsafe()` → `conn.query()`
- **`apps/runtime/src/env.ts`** — `BRIVEN_DATA_PLANE_URL` → `BRIVEN_DOLT_URL`
- **`apps/realtime/src/index.ts`** — driver import swapped, LISTEN/NOTIFY → Phase 2 stubs, `dbNameFor` replaces `schemaNameFor`
- **`apps/realtime/src/metrics.ts`** — help text updated for Dolt
- **`apps/realtime/src/env.ts`** — `BRIVEN_DATA_PLANE_URL` → `BRIVEN_DOLT_URL`
- **3 `package.json`** (api, runtime, realtime) — `"postgres"` → `"mysql2"`, removed `@types/pg`

**Known Phase 5 gaps (not blocking):**
- `RETURNING` clause removed from query builder — `.returning()` returns empty arrays
- `vectorSearch()` throws a descriptive error (LanceDB replacement pending)
- MySQL `TIMESTAMP` only stores to 2038-01-19 (acceptable for control-plane metadata)

**Known Phase 2 gaps (not blocking):**
- Realtime LISTEN/NOTIFY is stubbed — subscriptions record `touchedTables` but no change notifications fire
- Metrics counters (`briven_realtime_notifies_total`, `briven_realtime_channels_active`) are inactive

### Next action

Start **Phase 2**: implement Dolt commit-diff polling (`PollManager`), replace LISTEN/NOTIFY stubs in `apps/realtime/src/index.ts`, and add `dolt_diff()` query logic. See `docs/ADR/0001-dolt-migration.md` § "Realtime: LISTEN/NOTIFY → commit-diff polling".
