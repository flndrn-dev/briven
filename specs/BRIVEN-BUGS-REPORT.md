# Briven — consolidated bug report (NON-real-time) for one debugging + build-finishing pass

Date: 2026-06-27 · Session: bb266471 · Source: 4-agent audit + live DoltGres compatibility probe (facts, not guesses).
Scope: **excludes** real-time engine items (change-scoping, heartbeats, graceful shutdown, backpressure, horizontal scale, poll observability) — those live in `briven-realtime-production-ready.html` Phase 4. Real-time **WS auth** is already FIXED (uncommitted).

**Master root cause (why these exist):** the DoltGres convergence was applied to hot paths only; cold paths still use Postgres-isms DoltGres lacks and the old `postgres.js`/schema-per-project world. No test exercises real DoltGres, so each surfaces only in production. Prevention for ALL of them = the Phase-1 DoltGres integration test net (in progress).

Legend: severity 🔴 will-break · 🟠 breaks-on-use (cold) · 🟡 fragile/cleanup · ⬜ unfinished build.

---

## A. Data-plane SQL incompatibilities — CONFIRMED by live probe

### A1 🟠 `ILIKE` not supported — Studio search
- **Evidence:** probe → `ILIKE is not yet supported`. `apps/api/src/services/studio.ts:247` (`buildFilterClauses` 'contains').
- **Fix:** `"col"::text ILIKE '%'||$n||'%'` → `lower("col"::text) LIKE '%'||lower($n)||'%'`.
- **Test:** integration — filter rows case-insensitively on a real table.

### A2 🟠 `SET LOCAL` not supported — Studio raw-SQL runner
- **Evidence:** probe → `SET LOCAL is not yet supported`. `studio.ts:556-557` (`SET LOCAL search_path`, `SET LOCAL statement_timeout='5s'`).
- **Fix:** remove both. DB-per-project needs no `search_path`; statement_timeout isn't enforceable on DoltGres (drop or apply a client-side timeout).
- **Test:** `executeQuery` runs a SELECT in a project DB without error.

### A3 🟠 `TRUNCATE … RESTART IDENTITY` syntax error — Studio truncate
- **Evidence:** probe → `at or near "restart": syntax error`. `studio.ts:911` (`truncateTable`).
- **Fix:** emit plain `TRUNCATE "t"` (DoltGres has no identity sequences to restart); keep optional `CASCADE` only if probed OK.
- **Test:** truncate a seeded table → 0 rows.

### A4 🟠 `ON CONFLICT DO UPDATE` (`excluded` unknown) — config/meta upserts
- **Evidence:** probe → `table not found: excluded`. `apps/api/src/services/tenant-config-store.ts:211`, `apps/api/src/routes/auth-service.ts:127`. (Note: `ON CONFLICT DO NOTHING` PROBED OK — `schema-apply.ts:41` is fine.)
- **Fix:** manual upsert — `UPDATE … ; if 0 rows then INSERT`, or `INSERT … ON CONFLICT DO NOTHING` then `UPDATE`.
- **Test:** write same key twice → second updates, no error.

### A5 🟠 Row-tuple comparison cursor — auth admin pagination
- **Evidence:** probe → row-value `(a,b) < ($1,$2)` errors. `apps/api/src/services/auth-users.ts:176`, `apps/api/src/services/auth-audit.ts:106`.
- **Fix:** expand to `a < $1 OR (a = $1 AND b < $2)`.
- **Test:** paginate >1 page of users/audit rows.

### A6 🟠 `pg_index`/`array_position` introspection — Studio index list
- **Evidence:** probe → `operator does not exist: smallint = int2vector`. `studio.ts:1042` (`listIndexes`).
- **Fix:** rebuild via `information_schema.statistics`/`.table_constraints`, or graceful-degrade to `[]` with a logged note until supported.
- **Test:** list indexes on a table that has a PK + one index.

### A7 🔴 `citext` / `CREATE EXTENSION` — customer auth provisioning
- **Evidence:** probe → `type "citext" does not exist`, `CREATE EXTENSION … pg_config not found`. `apps/api/src/services/auth-provisioning.ts:37,42`.
- **Fix:** `email text` + a unique index on `lower(email)`; lowercase on read/write.
- **Test:** enable auth on a fresh project; `A@x.com` and `a@x.com` collide.

### A8 🔴 `vector(N)` column DDL — schema apply
- **Evidence:** probe → `at or near "(": syntax error`. `packages/schema/src/sql.ts:57`, `packages/schema/src/columns.ts:101`.
- **Fix:** reject `vector` columns at schema-apply with a clear "vector search coming with LanceDB" error (search is already stubbed at `query-builder.ts:287`).
- **Test:** deploy a schema containing a vector column → friendly validation error, not a 500.

---

## B. Driver / architecture cold-path landmines (postgres.js + wrong DB)

### B1 🔴 Better-Auth runtime on `postgres.js` + wrong DB — ALL customer auth
- **Evidence:** `apps/api/src/services/auth-tenant-pool.ts:89` opens `postgres()` with `search_path` to a *schema* `proj_<id>`, but auth tables were created in the *database* `proj_<id>` `public` schema (`routes/auth-service.ts:121`). postgres.js also desyncs vs DoltGres (`&{}`).
- **Fix:** build the Better-Auth adapter on a `pg` pool bound to the project DATABASE (mirror `runInProjectDatabase`/`poolFor`).
- **Test:** customer sign-up → sign-in → session, end-to-end on DoltGres.

### B2 🔴 `getStorageUsage` on `postgres.js` + wrong DB — silent 0
- **Evidence:** `apps/api/src/services/usage.ts:181` via `dataPlaneClient()` + `schemaNameFor`; masked by try/catch → always `{bytes:0}`. Caller: `workers/usage-aggregator.ts`.
- **Fix:** `pg` pool bound to `proj_<id>` DB; query `public` (the SQL — `pg_total_relation_size`/`::regclass` — PROBED OK).
- **Test:** seed a table → storage usage > 0.

### B3 🟠 `db shell` role provisioning on `postgres.js` + schema model
- **Evidence:** `apps/api/src/db/data-plane.ts:189,222` (`provisionProjectRole`/`rotateProjectRolePassword`) — `GRANT … ON SCHEMA "proj_<id>"` via postgres.js. Caller: `services/db-shell.ts`.
- **Fix:** port to `pg` + database-per-project, or redesign `db shell` creds; then delete the legacy fns.
- **Test:** `briven db shell` issues a credential that connects to the project DB.

### B4 🟡 Retire the second world (after B1–B3)
- **Evidence:** `pgjsClient`/`dataPlaneClient`/`schemaNameFor` (`data-plane.ts:46-72,342`) — "slated for Stage-2 removal."
- **Fix:** delete once nothing calls them. **Prevention:** removes the entire class of "wrong driver / wrong DB" bugs permanently.

---

## C. Deploy-path

### C1 🟡 Dead plpgsql `NOTIFY` trigger emitted on every deploy
- **Evidence:** `apps/api/src/services/schema-apply.ts:101-131` emits `CREATE FUNCTION … plpgsql … pg_notify` + `CREATE TRIGGER` per table. Probe: the DDL is ACCEPTED (not a crash) — but it's **dead code** (realtime uses `DOLT_HASHOF` polling, not LISTEN/NOTIFY). ⚠️ Probe verified DDL creation only, **not an INSERT firing the trigger** — verify that an insert with the trigger present succeeds.
- **Fix:** remove the trigger emission entirely.
- **Test:** deploy a schema → insert a row → succeeds; no trigger created.

---

## D. Auth carve-out drift (broken access — same class as the Studio bug)

### D1 🟠 Broad `/v1/projects/*` session guard shadows `requireProjectAuth`
- **Evidence:** `apps/api/src/routes/projects.ts:81-82` runs before later routers; `brk_` keys 401 on `/env`, `/db/*`, `/logs/*`, `/usage`, `/export` (and `/studio/*`, `/ai/*`). Confirmed by a Hono repro.
- **Fix:** make the broad guard `brk_`-aware (attempt `resolveApiKey`) **or** drop it and rely on each router's own guard (they all declare one). Removes the recurring "it 401s with a key" bug for good.
- **Test:** integration — a `brk_` key reaches each project route per an expected matrix (this test replaces the misleading isolated-router tests).

### D2 🔴 `BRIVEN_BETTER_AUTH_SECRET` is optional → forgeable CLI JWTs
- **Evidence:** `apps/api/src/env.ts:31` `.optional()`; `lib/cli-jwt.ts:14` → if unset, signs with the constant bytes of `"undefined"`.
- **Fix:** require it at boot (drop `.optional()` or assert before sign/verify) → fail-closed.
- **Test:** boot with the var unset → process exits with a clear error.

---

## E. Control-plane dashboard queries (fragile, not currently broken)

> These run on the CONTROL plane = stock Postgres, where they're fine. They ONLY break if the control DB is ever pointed at DoltGres (it must not be). Probe confirmed `count(*) FILTER` and `percentile_cont WITHIN GROUP` FAIL on DoltGres. Keep as a guardrail, low priority.

### E1 🟡 `getHourlyInvocations` — `function-logs.ts:64` (`generate_series` + `count FILTER`)
- A prod "Failed query" was seen here earlier — **verify on the live control DB** (generate_series PROBED OK on DoltGres; `FILTER` does not — so confirm control plane really is stock Postgres). Fix if needed: zero-fill 24 buckets in TS; avoid `FILTER`.
### E2 🟡 `getFunctionStats` — `function-logs.ts:118` (`percentile_cont WITHIN GROUP`, `FILTER`)
- Same exposure; same guardrail.

---

## F. Runtime executor inconsistencies

### F1 🟠 `DELETE … RETURNING` inline-vs-isolate mismatch
- **Evidence:** inline executor `apps/runtime/src/query-builder.ts:248-271` returns `[]` always; isolate `isolate-runtime/loop.ts:445-465` implements it. Probe PROVED `DELETE … RETURNING` WORKS on DoltGres — so the inline stub is needlessly wrong and the two executors disagree.
- **Fix:** implement `RETURNING` in the inline executor (the comment already spells out how); same behavior under both.
- **Test:** `.delete().returning()` returns the deleted rows under inline AND deno.

### F2 🟡 `vectorSearch()` missing on isolate executor
- **Evidence:** inline throws a friendly Phase-5 error; isolate lacks the method → raw `TypeError` under deno.
- **Fix:** add a matching throwing stub. **Test:** call vectorSearch under deno → friendly error.

---

## G. Unfinished builds ("finishing of builds") — inventory

> Confirm intent before building; the big ones are NOT needed to unblock Katsuro and should likely be deferred.

| Build | Where | State | Needed for Katsuro? |
|---|---|---|---|
| ⬜ Runtime-side project DB provisioning | `apps/runtime/src/db.ts:31-62` | missing — first write to a NEW project fails at connect | **YES — hard blocker** |
| ⬜ SDK publish path (`dist`/npm) | `packages/*` `0.0.1` exporting `./src` | verify before external repo consumes | **YES** |
| ⬜ Branches / preview envs | `services/branches.ts:61` | 501 stub | no |
| ⬜ Workflows / automation | `services/workflows.ts:97` | 501 stub | no |
| ⬜ Prepaid wallet billing (SPEC pillar) | absent in `services/billing.ts` | not built | no (but needed for paid signups) |
| ⬜ SLA auto-credit | `services/sla.ts:114` | stub (downtime always 0) | no |
| ⬜ Export/import row data | `services/export-import.ts:11` | schema+functions only | no |
| ⬜ Tier hard-enforcement (storage/RT) | `services/tiers.ts:15` | soft cap only | no |
| ⬜ Polar metering push | `workers/polar-meter-push.ts:104` | inert until token+IDs set | no (until billing) |
| 🟡 apps/studio (Supabase fork) | broken build | replaced by apps/web dashboard | no — ignore |

---

## Recommended ONE-pass fix order (batches, each verified against the Phase-1 DoltGres test net before deploy)

1. **Foundation (in progress):** DoltGres integration test net + CI gate + delete the stale "MySQL" `studio.test.ts`. *(makes every fix below verifiable)*
2. **Batch A (surgical, low-risk):** A1 ILIKE · A2 SET LOCAL · A3 TRUNCATE · A6 index list · A8 vector gate · F1 DELETE RETURNING · C1 dead trigger · snapshots LIKE align. + commit realtime WS auth.
3. **Batch B (landmines):** A7 citext · B1 Better-Auth · B2 storage · A4 ON CONFLICT · A5 cursors · B3/B4 retire legacy · D1 auth carve-out · D2 auth secret · G runtime DB provisioning.
4. **Deploy once → prove ISY live loop + fresh-project auth + first write.**
5. Real-time hardening (Phase 4) + decide which G builds to finish.

Every item's permanent prevention is the same: the DoltGres integration test in CI before deploy (Foundation).
