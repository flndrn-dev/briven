# docs/BUILD_PLAN.md — briven platform build plan (DoltGres convergence)

> **Status:** active · authored 2026-06-26 after a full 4-way code audit of `feat/admin-manifest`.
> **Companion docs:** `SPEC.md` (product spec + the 2026-06-26 engine-decision banner), `CLAUDE.md` (rulebook + gotchas).
> **Goal (Jürgen's words):** a clean, modern, **100% real-time production-running DoltGres** database platform — no leftover "old version" code.

This plan supersedes `road-to-ga.md`, `BACKEND_FORK_*.md`, `HANDOFF.md`, `HANDOFF-DOLT.md`, `BLOCKER.md`, and `VERIFICATION_AUDIT.md` for the engine/architecture path. Those describe abandoned directions (a MySQL-mode Dolt detour, and a full Supabase-services stack) and are slated for archival in Stage 2.

---

## 1. The core problem (why nothing works end-to-end today)

The platform is **split-brained across two databases**:

| Layer | Speaks | Evidence |
|---|---|---|
| `apps/api` (control plane: auth, project provisioning, snapshots) | **Postgres** (`postgres-js`, drizzle, `BRIVEN_DATABASE_URL` / `BRIVEN_DATA_PLANE_URL`) | `apps/api/src/db/client.ts`, `db/data-plane.ts`, `env.ts:223-252` |
| `apps/runtime` (user-function DB access) | **Dolt MySQL-wire** (`mysql2`, `USE proj_<id>`, `BRIVEN_URL`) | `apps/runtime/src/db.ts`, `query-builder.ts` |
| `apps/realtime` (change detection / live updates) | **Dolt MySQL-wire** (`mysql2`, `BRIVEN_HASHOF('HEAD')`) | `apps/realtime/src/poll-manager.ts` |
| Deployed infra | **Dolt only** (`dolthub/dolt-sql-server`) — and missing the Postgres env the API needs | `infra/dokploy/compose.yml` |

The API provisions a **Postgres schema** `proj_x`; the runtime/realtime read a **Dolt-MySQL database** `proj_x` that nothing creates. Different engines, different data → create-project → table → insert → query → live-update can never complete. Neither half is DoltGres.

## 2. The decision — converge on DoltGres (Postgres-wire)

DoltGres (`github.com/dolthub/doltgresql`) is **Postgres-wire-compatible git-for-data**. Converging there means:
- `apps/api` (the largest surface) keeps its Postgres driver + drizzle with little change — DoltGres answers the Postgres protocol.
- `apps/runtime` + `apps/realtime` **revert off `mysql2`** back to the Postgres client (the pre-detour code path still exists in git history) and point at DoltGres.
- Git-for-data features (Undo/Snapshots/Branches) use **DoltGres-native** versioning instead of the current Postgres-schema-copy hack.
- One database image, one set of env vars, one provisioning model.

### Driver & DB topology — VERIFIED 2026-06-26 (corrects an earlier assumption)
Hands-on testing against a real local DoltGres (`dolthub/doltgresql:latest`, identifies as PG 15.5) found:
- **postgres.js does NOT work with this DoltGres build** — its extended-protocol pipelining desyncs (`unhandled message "&{}"`), even on `SELECT 1`. Only `.simple()` works (no safe params). So the earlier "the API's postgres.js code just works on DoltGres" was wrong.
- **`pg` (node-postgres) works perfectly** — plain + parameterized (`$1`), plus the full git-for-data loop (`SET dolt_transaction_commit=1` → committed write → `DOLT_HASHOF('HEAD')` advances → `RETURNING` → `dolt_log` grows).

**Resulting topology:**
- **Control plane** (`BRIVEN_DATABASE_URL`: platform users/projects/billing — no undo needed) → **stock Postgres**, keep postgres.js + drizzle. *Must point at real Postgres, NOT DoltGres.*
- **Customer data plane** (`BRIVEN_DATA_PLANE_URL`: per-project `proj_<id>` DoltGres databases) → **`pg` driver**. The data-plane code in `apps/runtime`, `apps/realtime`, and `apps/api` (`data-plane.ts`) uses `pg`, one pool per project bound to its database, `SET dolt_transaction_commit=1` per write-tx.

### Real-time mechanism (to finalise in Stage 1, using the Dolt docs Jürgen provided)
Two candidates, decide by testing against a real DoltGres instance:
- **(A) Postgres `LISTEN/NOTIFY` + triggers** — instant push; the channel/registry/WS machinery already exists in `apps/realtime`. **Requires** DoltGres to support `LISTEN/NOTIFY` + triggers (verify — early DoltGres lacked them).
- **(B) Commit-diff polling** — poll DoltGres `HEAD` (its real versioning function, **not** the fake `BRIVEN_HASHOF`) every ~500 ms and re-invoke on change. Already coded (just on the wrong driver/function). Works with git-for-data; ~500 ms latency.
> Default if unsure: ship **(B)** first (it leverages git-for-data and is closest to working), keep the LISTEN/NOTIFY path as the upgrade. **Whichever ships must actually fire — verified, not assumed.**

## 3. What's genuinely real vs what must be built (audit 2026-06-26)

**Real & solid (keep):**
- Deno-isolate **function runtime** (`apps/runtime` pool-manager) — production-grade.
- **Better Auth** (email/password, magic-link, social, API keys, CLI JWT) — fully real.
- **Snapshots / auto-snapshots** — real, but Postgres-schema-copy based; reframe onto DoltGres-native versioning.
- Postgres **project provisioning + schema/role isolation** — real (needs to target DoltGres).
- The realtime **subscribe→fan-out→push pipeline code** — complete in structure.

**Broken / stubbed / must-fix:**
- **Engine split-brain** (§1) — the headline fix.
- **Live updates never fire:** nothing ever commits (no `DOLT_COMMIT`/commit-on-write), and `BRIVEN_HASHOF` is **not a real function** (stock Dolt exposes `DOLT_HASHOF`/`HASHOF`); errors are silently swallowed (`poll-manager.ts:116-120`).
- **Nothing provisions the engine-room database** for a project on the runtime side.
- `.returning()` on insert/update is a **no-op returning `[]`** (`query-builder.ts`).
- `vectorSearch()` **throws** (Phase 5 / LanceDB).
- **Branches** service throws `not_implemented` (501).
- `apps/studio` (Supabase fork) does **not build** — missing `@/data/*` layer; gated off in prod.
- **`pnpm install` fails** on native `libpg-query@15.2.0` (macOS SDK `strchrnul` clash) — pnpm 9 ignores the v10-style `ignoredBuiltDependencies` gate. Workaround `--ignore-scripts`; proper fix = align pnpm version / relocate the build-gate / bump the dep.
- Old **CLI deploy bug** (found during the ISY test): `briven deploy` rejects a valid schema unless the schema folder is ESM (`{"type":"module"}`) — tsx double-wraps the default export under CJS. Fix in the CLI loader (`packages/cli`).

## 4. Staged plan

### Stage 1 — Make it work, on the dev machine (LOCAL, no live server) — ✅ DONE 2026-06-26
> Reactive loop proven 6/6 against local DoltGres (provision DB → runtime write auto-commits → realtime polls `DOLT_HASHOF('HEAD')` → fires live update → row queryable). Data plane on `pg`; postgres.js found incompatible with DoltGres. Converged packages typecheck green.
Converge the code on DoltGres and **prove** the end-to-end loop locally.
1. Stand up **DoltGres locally** (Docker) + confirm Postgres-wire connectivity.
2. Decide schema-per-project vs database-per-project on DoltGres; make `apps/api` provisioning + runtime/realtime **agree** on where `proj_x` lives.
3. **Revert `apps/runtime` + `apps/realtime` off `mysql2`** to the Postgres client pointed at DoltGres; delete MySQL-isms (backticks, `USE`, `JSON_OBJECT`, `BRIVEN_HASHOF`).
4. Make the **write path commit** so versioning advances; wire the real-time mechanism (§2) and confirm it **actually pushes** an update.
5. Fix `.returning()` so inserts return rows.
6. Local migrations/bootstrap for the DoltGres control schema.
7. **Verification (the Stage-1 done-test):** on the dev machine — create project → create table → insert row → query it back → observe a **live update** on a subscription. Capture the evidence (logs/output).

### Stage 2 — Clean out the old version (LOCAL) — ✅ MOSTLY DONE 2026-06-26
> Done: API repointed to database-per-project (`runInProjectDatabase`, 7 services), old schema funcs removed; CLI MySQL→`psql`/`pg_dump` + the `briven deploy` ESM double-default bug FIXED (regression test, 71/71 pass); ADR-0002 authored, 7 stale docs archived. All briven-owned packages typecheck green (only the pre-existing broken Supabase-fork `studio/*` packages still fail).
> **Deferred (named follow-ups):** (a) **snapshots redesign** onto DoltGres-native commits/branches (TODO in `snapshots.ts`); (b) **infra reconciliation** — decide `infra/coolify` (repo docs say it's supported — needs Jürgen's call), keep/drop `infra/datapane` Supabase-stack + `infra/k8s` stub, write ONE consistent DoltGres `compose.yml` (folds into Stage 3); (c) **studio Supabase→briven rebrand** stragglers (cosmetic; studio fork is separately broken).
- Remove MySQL-detour leftovers across `apps/runtime`, `apps/realtime`, `packages/cli` (`db shell`/`export` MySQL paths), and MySQL-spec'd `apps/api` tests/services.
- Fix the dangling `docs/ADR/0001` reference; author **`docs/ADR/0002-converge-on-doltgres.md`**; archive `HANDOFF-DOLT.md`, `BACKEND_FORK_*.md`, `BLOCKER.md`, `VERIFICATION_AUDIT.md`, `road-to-ga.md` under `docs/archive/`.
- Fix the **CLI deploy ESM bug** (§3).
- Finish the Supabase→briven rename stragglers (the three `@supabase/*` workspace package names, `eslint-config-supabase` folder, logo assets) — opportunistic, not a blocking full sweep.
- Decide `infra/coolify` (repo docs currently say it's supported — confirm with Jürgen before deleting), drop `infra/datapane` Supabase-services stack if not used, and the `infra/k8s` stub.

### Stage 3 — Production (HOT ZONE — ask first, explain blast radius each time)
- One consistent **DoltGres `compose.yml`** (single DB image, consistent env-var names, real init/migrations).
- Real **backups** (replace the placeholder `dolt-backup` + Postgres `pg_dump` scripts) and **observability** suited to DoltGres.
- Deploy to briven.tech via Dokploy; verify `/ready` 200 + `briven doctor` green + the end-to-end loop **in production**.
- Then resume the **ISY connection test** (first real customer dogfood).

### Stage 4 — Sync
- Push the cleaned, converged code to **Codeberg** (`feat/admin-manifest` → reviewed → `main`).
- Refresh the imported network-drive folder so it matches.

## 5. Hot zones (verify-before-build; ask Jürgen first; consent doesn't carry over)
Live briven.tech deploy · the kvm4 shared Docker host · customer DB provisioning & data · billing/payments · auth/sessions · secrets/firewall/public exposure. Stage 1 & 2 touch **none** of these (all local). Stage 3 touches all of them.

## 6. Verification rule (every stage)
State the check before starting; run it after; report with **real evidence** (command output, a fired live-update, a green `briven doctor`) — never "looks done." A passing typecheck is not proof the feature works.
