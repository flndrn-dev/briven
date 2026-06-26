> ⚠️ SUPERSEDED (2026-06-26) — describes an abandoned architecture (MySQL-mode Dolt detour and/or full Supabase-services stack). Current truth: SPEC.md + docs/BUILD_PLAN.md + docs/ADR/0002.

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
| 2 | Realtime: commit-diff polling, PollManager, trigger removal | **done** |
| 3 | Auth: Better Auth mysql-core adapter | **done** |
| 4 | Storage: MinIO (unchanged) | **done** |
| 5 | Edge functions: MySQL query builder, LanceDB vectors | **done** |
| 6 | AI: unchanged | **done** |
| 7 | Payments: mavi-pay BillingProvider, Dolt-native meters | **done** |
| 8 | Infrastructure: Dolt compose, dolt backup, mysqld_exporter | **done** |
| 9 | Website rebrand: 7-pillar feature grid, pricing, copy | pending |
| 10 | Dolt-native features: branching UX, time-travel, DoltHub | pending |
| 11 | Testing, CLI, cutover runbook | pending |

### Key architectural decisions (from ADR)

- **Driver:** `mysql2/promise` replaces `postgres` (postgres.js) across api, runtime, realtime
- **ORM:** `drizzle-orm/mysql-core` replaces `pg-core` for control-plane schema (`apps/api/src/db/schema.ts`, 1171 lines)
- **Tenant isolation:** `CREATE DATABASE proj_<id>` per project, `USE proj_<id>` instead of `SET LOCAL search_path`
- **Vector search:** LanceDB embedded replaces pgvector, `ctx.db.vectorSearch()` API unchanged
- **Extensions:** pg_cron→node-cron dispatcher, pgmq→Redis streams
- **Infrastructure:** single `BRIVEN_URL=mysql://...` env var replaces two Postgres URLs
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

- **`apps/api/src/db/schema.ts`** (1146 lines) — pg-core → mysql-core, 30+ tables, `text` PK → `varchar(36)`, `timestamptz` → `timestamp(3)`, `jsonb` → `json`, partial unique indexes dropped (application-level enforcement). All `@README-BRIVEN` markers on affected indexes.
- **`apps/api/src/db/client.ts`** — postgres-js → mysql2 pool (`drizzle-orm/mysql2`), `BRIVEN_DATABASE_URL` → `BRIVEN_URL`
- **`apps/api/src/db/auth-customer-schema.ts`** — pg-core → mysql-core, `citext` → `utf8mb4_unicode_ci` collation
- **`apps/api/src/db/data-plane.ts`** — `CREATE SCHEMA` → `CREATE DATABASE`, `SET search_path` → `USE database` (per-connection), pg_roles → MySQL users, `$1` → `?` placeholders
- **`apps/api/drizzle.config.ts`** — `dialect: 'postgresql'` → `dialect: 'mysql'`
- **`apps/api/src/services/auth-tenant-pool.ts`** — `connection.search_path` → `database` pool option, `provider: 'pg'` → `provider: 'mysql'`
- **`apps/api/src/services/db-shell.ts`** — DSN generation for `mysql` client (not `psql`)
- **`apps/api/src/routes/health.ts`** — merged control + data plane checks into single `dolt` check
- **`apps/api/src/routes/auth-service.ts`** — `BRIVEN_DATA_PLANE_URL` → `BRIVEN_URL`
- **5 workers** (`account-deletion-gc`, `outbound-webhook-dispatcher`, `polar-meter-push`, `schedule-dispatcher`, `storage-janitor`, `usage-aggregator`) — env var check updated
- **4 test files** — `BRIVEN_DATABASE_URL` → `BRIVEN_URL`, placeholder URLs updated
- **`apps/api/src/env.ts`** — single `BRIVEN_URL` replaces both `BRIVEN_DATABASE_URL` and `BRIVEN_DATA_PLANE_URL`
- **`apps/runtime/src/db.ts`** — postgres → mysql2, `search_path` → `USE database`, transaction API
- **`apps/runtime/src/query-builder.ts`** — `postgres.TransactionSql` → `PoolConnection`, `"..."` → `` `...` ``, `$N` → `?`, `RETURNING` removed (Phase 5 gap), vector search throws (Phase 5 gap)
- **`apps/runtime/src/index.ts`** — health probe uses `mysql2/promise`
- **`apps/runtime/src/runtime-bootstrap.ts`** — `tx.unsafe()` → `conn.query()`
- **`apps/runtime/src/env.ts`** — `BRIVEN_DATA_PLANE_URL` → `BRIVEN_URL`
- **`apps/realtime/src/index.ts`** — driver import swapped, LISTEN/NOTIFY → Phase 2 stubs, `dbNameFor` replaces `schemaNameFor`
- **`apps/realtime/src/metrics.ts`** — help text updated for Dolt
- **`apps/realtime/src/env.ts`** — `BRIVEN_DATA_PLANE_URL` → `BRIVEN_URL`
- **3 `package.json`** (api, runtime, realtime) — `"postgres"` → `"mysql2"`, removed `@types/pg`

**Known Phase 5 gaps (not blocking):**
- `RETURNING` clause removed from query builder — `.returning()` returns empty arrays
- `vectorSearch()` throws a descriptive error (LanceDB replacement pending)
- MySQL `TIMESTAMP` only stores to 2038-01-19 (acceptable for control-plane metadata)

### Phase 2 complete (2026-06-07)

**3 files changed / 1 new file:**

- **`apps/realtime/src/poll-manager.ts`** (new, 164 lines) — `PollManager` class that queries `BRIVEN_HASHOF('HEAD')` for each active project at the configured interval. When the hash changes, fires every channel for that project via the `fireChannel` callback. Pool auto-starts on first project; auto-stops when no projects remain.
- **`apps/realtime/src/index.ts`** — replaced `startListen`/`stopListen` stubs with real implementations. Added `projectRefCount` map to track per-project channel counts; `projectIdFromChannel()` parses channel names to extract project IDs. PollManager pool eager-init'd at boot.
- **`apps/realtime/src/subscription-registry.ts`** — added `channelsForProject(projectId)` prefix-matching method.
- **`apps/realtime/src/env.ts`** — added `BRIVEN_REALTIME_POLL_MS` (default 500ms, floor 100ms, cap 5000ms).
- **`apps/realtime/src/metrics.ts`** — updated help text to reflect live commit-diff polling.

**Design decisions:**
- Polls at project granularity (not per-table). When any table in a project changes, all channels for that project fire. Simpler and correct — over-fires slightly but avoids per-table `dolt_diff` queries.
- `projectIdFromChannel()` extracts the project id from channel names (`briven_proj_<sanitized>_<table>`). Since project ids are sanitised to alphanumeric+underscores, this is fully reversible.
- First poll for a project stores the initial hash without firing — avoids spurious re-invocation on subscribe.

### Phase 3 complete (2026-06-07)

**3 files changed:**

- **`apps/api/src/lib/auth.ts`** — `provider: 'pg'` → `provider: 'mysql'` in the control-plane Better Auth adapter. This was silently broken — `getDb()` returns a mysql2 drizzle instance but Better Auth was told to generate Postgres SQL.
- **`apps/api/src/services/auth-provisioning.ts`** — full DDL rewrite for MySQL. Replaced `CREATE EXTENSION citext`, `text PRIMARY KEY`, `citext` column type, `timestamptz`, `jsonb`, double-quote identifiers, and `now()` with their MySQL equivalents (`VARCHAR(36)`, `COLLATE utf8mb4_unicode_ci`, `TIMESTAMP(3)`, `JSON`, backtick identifiers, `CURRENT_TIMESTAMP(3)`). FK constraints moved to explicit CONSTRAINT syntax.
- **`apps/api/src/services/auth-provisioning.test.ts`** — all 11 test assertions updated to match MySQL DDL output.

### Phases 6–8 complete (2026-06-07)

**Phase 6 — AI: confirmed unaffected.** Ollama/OpenAI features communicate via HTTP to the AI backend. Zero database SQL queries. Gated by `BRIVEN_OLLAMA_URL`.

**Phase 7 — Payments: BillingProvider interface + Dolt-native meters.**

- **`services/billing/provider.ts`** (new) — `BillingProvider` interface with `pushMeterEvents`, `createCheckout`, `createPortalSession`. `getBillingProvider()` factory switches on `BRIVEN_BILLING_PROVIDER` env var (`'polar'` today, `'mavi-pay'` when ready).
- **`services/billing/dolt-meters.ts`** (new) — three Dolt-native meter queries: `getBranchCount()` (reads `dolt_branches`), `getCommitCountThisMonth()` (reads `dolt_log` filtered to current month), `getTimeTravelRetentionDays()` (reads `_briven_meta` config). Combined via `getDoltMeters(projectId)`.

**Phase 8 — Infrastructure: compose file fully migrated.**

- **`infra/dokploy/compose.yml`** — `postgres` service → `dolt` (`dolthub/dolt-sql-server:latest`). Single `BRIVEN_URL=mysql://root:...@briven-dolt:3306/briven_control` replaces `BRIVEN_DATABASE_URL` + `BRIVEN_DATA_PLANE_URL`. Added `dolt-backup` placeholder service. `BRIVEN_POSTGRES_PASSWORD` → `BRIVEN_DOLT_ROOT_PASSWORD`. Updated all service env vars (api, runtime, realtime). Volume renamed `postgres_data` → `dolt_data`.

### Next action

Start **Phase 9**: website rebrand — 7-pillar feature grid, updated pricing, copy changes across the marketing site and docs to reflect the Dolt-native platform story.
