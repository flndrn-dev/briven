> ⚠️ SUPERSEDED (2026-06-26) — describes an abandoned architecture (MySQL-mode Dolt detour and/or full Supabase-services stack). Current truth: SPEC.md + docs/BUILD_PLAN.md + docs/ADR/0002.

# road-to-ga.md — briven completion plan

## Goal
Close every phase exit-criterion from `docs/TODO.md` so briven reaches GA (Q1–Q2 2027) with 25+ paying customers and €2k+ MRR.

**Calendar:** ~2 months. **Effort:** ~55–80 Claude session-days. **Critical path:** realtime LISTEN/NOTIFY → ISY E2E → videodj migration → metering → self-host release.

Mark each box `[x]` as work lands on `main`. Keep this file at repo root and updated.

---

## Phase 0 — Foundations close-out (1 day)

Exit when: nightly cold-storage backup confirmed in R2/B2, alerts route to Discord, trademark application filed.

- [ ] **0.1 Off-site backup target (R2 or B2)** — J provisions bucket + access key + secret; write `BRIVEN_BACKUP_S3_ENDPOINT|BUCKET|ACCESS_KEY|SECRET` into `/opt/briven/.env` on kvm4; extend `infra/backups/briven-backup.sh` to mirror the local MinIO snapshot via `aws s3 cp --endpoint-url …` after the local upload succeeds (idempotent: if remote upload fails, exit non-zero so the systemd timer rings the Discord webhook). → **Verify:** run `systemctl start briven-backup.service` once; confirm the latest `pg_dump` lands in the off-site bucket and sha256 matches the local copy.
- [ ] **0.2 Discord webhooks** — J creates `#briven-alerts` (P0/P1) + `#briven-deploys` (info) webhook URLs in the briven Discord server (per `docs/runbooks/discord-setup.md` §4); persist as `BRIVEN_DISCORD_WEBHOOK_ALERTS` + `BRIVEN_DISCORD_WEBHOOK_DEPLOYS` in the Dokploy observability-stack env (those names match `docs/runbooks/discord-setup.md` and `infra/observability/compose.yml`) + Uptime Kuma notification settings; alertmanager `receivers.alerts` / `receivers.deploys` are already wired in `infra/observability/alertmanager/alertmanager.yml` (benjojo/alertmanager-discord bridges). → **Verify:** run the two synthetic-alert smoke tests in `docs/runbooks/discord-setup.md` §10 (do NOT kill production containers); confirm both Discord messages arrive within 60 s.
- [x] **0.3 Trademark filing EU + Benelux** — J-only. File `briven` word mark, classes 9 (software) + 42 (SaaS). Capture filing receipts under `docs/legal/trademark/`. → **Verify:** filing reference numbers committed; renewal date added to ops calendar.
- [ ] **0.4 Phase 0 sign-off** — update `docs/TODO.md` Phase 0 status from "closing soon" to "closed"; write Phase 0 close-out ADR under `docs/ADR/`. → **Verify:** PR merged; status row green in `BUILD_PLAN_STATUS_*.md`.

---

## Phase 1 — MVP engine close-out (1 day)

Exit when: a `briven deploy` against ISY `briven/functions/poolStats.ts` returns green end-to-end and a client subscription receives a NOTIFY-driven re-invoke push.

- [ ] **1.1 Realtime subscription registry** — in `apps/realtime/src/`, add `subscription-registry.ts`: in-memory map `{ projectId → { tableName → Set<subscriberId> } }` with ref-counted add/remove. → **Verify:** unit test asserts add → add same → remove → remove same → empty.
- [ ] **1.2 Per-table LISTEN / UNLISTEN driver** — one pg client per project schema; `LISTEN briven_change_<table>` on first subscriber, `UNLISTEN` on last drop. Wire to `subscription-registry`. → **Verify:** integration test against a throwaway pg schema receives a payload after a manual `NOTIFY`.
- [ ] **1.3 NOTIFY → re-invoke fan-out** — on NOTIFY payload, look up dependent subscriptions, call `runtime` to re-invoke the affected query, push the new result frame over the existing WS. Increment `briven_realtime_reinvoke_total{outcome}` (already exposed via `metrics.ts`). → **Verify:** end-to-end test: subscribe to `getPosts`, `INSERT INTO posts`, client receives updated frame within 500 ms locally.
- [ ] **1.4 Auto-generated change triggers** — schema-DSL compile step emits `CREATE TRIGGER briven_notify_<table> AFTER INSERT|UPDATE|DELETE … EXECUTE FUNCTION briven_notify_change()` per table; `briven_notify_change()` PL/pgSQL emits `NOTIFY briven_change_<table>, json_build_object('op', TG_OP, 'id', NEW.id)`. Stored in `_briven_meta` migration ledger. → **Verify:** new migration row in `_briven_migrations`; manual INSERT fires NOTIFY visible to `pg_listen`.
- [ ] **1.5 ISY dogfood E2E** — on the ISY `test/briven-dogfood` branch: `pnpm add -D file:.../briven-cli-0.1.0.tgz`, run `briven link`, then `briven deploy`. Hit the deployed `poolStats` from a Node script via `@briven/client`. → **Verify:** deploy record status=succeeded; query result matches the local Convex reference output; subscription receives a push after a manual row change.
- [ ] **1.6 Phase 1 sign-off** — update `BUILD_PLAN.md` Phase 1 → closed; record exit criterion (green deploy hash + timestamp) in an ADR. → **Verify:** PR merged; dogfood evidence linked.

---

## Phase 2 — Dogfood alpha (5 days, close end-May 2026)

Exit when: videodj runs in production on briven, Studio supports read browsing, monthly restore drill runs from cron, load harness hit 1k concurrent on kvm4 without failures.

### A. Studio read mode

- [ ] **2.1 Per-table data view route** — `apps/web/src/app/(dashboard)/dashboard/projects/[id]/studio/[table]/page.tsx` exists; add server-side fetch via new `services/studio.ts:getTableRows(projectId, table, { limit, offset, orderBy, filter })` (parameterised SQL; reject `_briven_*` tables; cap limit at 200). → **Verify:** browser shows first 50 rows from a real project table; pagination + sort-header click works.
- [ ] **2.2 Column metadata** — extend `services/studio.ts` with `getTableColumns(projectId, table)` querying `information_schema.columns` (name, type, nullable, default, is_primary_key). Render type/null/PK markers in the column header. → **Verify:** PK marker on `id`; nullable columns show "·"; type badge matches Postgres.
- [ ] **2.3 Filter UI** — header filter row: text input per column, `= / contains / >` operator dropdown; serialise to `?filter[col][op]=value`. Server validates op against an allow-list. → **Verify:** filter on a varchar column reduces row count; SQL-injection attempt (`'; DROP TABLE …`) returns 400.

### B. Product migration

- [ ] **2.4 Migrate videodj** — sole Phase 2 migration target. Follow `MIGRATION.md` end-to-end: schema diff → function port → cutover → 7-day soak. → **Verify:** 100 % of videodj prod traffic served from briven for 7 consecutive days; zero P0/P1; rollback plan rehearsed once; `MIGRATION.md` updated with lessons-learned section.

### C. Operations & infra

- [ ] **2.8 Infra split KVM2 + KVM4** — 🔒 J rents KVM2; Claude wires Dokploy projects (control plane → KVM2, data plane → KVM4); migrate Postgres via `pg_basebackup` + replication switchover. → **Verify:** control-plane API answers from KVM2; data-plane Postgres primary on KVM4; replication lag < 1 s in steady state.
- [ ] **2.9 drizzle-kit snapshot regen** — 🔒 J runs `pnpm --filter @briven/api db:generate` in a real TTY, resolves rename/drop prompts, commits `0010_*.sql` + `0010_snapshot.json`. → **Verify:** `drizzle-kit generate` runs non-interactively afterwards; `usage_rollups` + `abuse_reports` tables can be added without further blockers.
- [ ] **2.10 Load harness on live KVM4** — `bun infra/load-tests/realtime-subs.ts --project p_… --bootstrap … --concurrent 1000 --duration 5m`. → **Verify:** p99 first-frame < 500 ms, 0 connection failures, no daemon-pressure alarms on the shared host.
- [ ] **2.11 Restore-drill cron on kvm** — J `scp`s `infra/backups/briven-restore-drill.{service,timer,sh}` to `/opt/briven/`, `systemctl enable --now briven-restore-drill.timer`. → **Verify:** `systemctl list-timers` shows next fire on the 1st at 04:30 UTC; manual `systemctl start` exits 0 and posts success to `#briven-deploys`.

---

## Phase 3 — Private beta (10 days, close half-May 2026)

Exit when: usage meters bill correctly against Polar for 3 paying customers, abuse pipeline triages reports from the dashboard, AI schema generator drafts a viable `schema.ts` from a prompt.

### A. Usage metering

- [ ] **3.1 RT connection-seconds signal** — `apps/realtime` emits `briven_connection_seconds_total` (already on `/metrics`). Add worker `workers/connection-seconds-scraper.ts` that scrapes the realtime `/metrics` every 60 s, deltas the counter into `usage_events { project_id, kind: 'connection_seconds', value, observed_at }`. → **Verify:** open 3 WS subs for 5 minutes; `usage_events` shows ≈900 seconds; idempotent on worker restart.
- [ ] **3.2 `usage_rollups` snapshot pre-prune** — depends on **2.9**. Create `usage_rollups { project_id, period_start, kind, value }`; daily cron snapshots aggregates from `function_logs` + `usage_events` before the 7-day prune. → **Verify:** pruning `function_logs` no longer under-counts the previous month's invocations.
- [ ] **3.3 Polar dashboard config** — 🔒 J creates 3 meters (`briven_invocations`, `briven_storage_bytes`, `briven_connection_seconds`); writes ids into `BRIVEN_POLAR_METER_*_ID`; attaches per-tier overage prices to Pro + Team (free tier hard-capped). Follow `docs/runbooks/polar-metering-setup.md`. → **Verify:** test event from `workers/polar-meter-push.ts` shows up in the Polar dashboard for a sandbox customer.

### B. Abuse pipeline

- [ ] **3.4 Migrate to dedicated `abuse_reports` table** — depends on **2.9**. Schema: `id, project_id, reporter_email_hash, reason, severity, status, resolution, notes, created_at, resolved_at, ip_hash`. Backfill from `audit_logs` rows. → **Verify:** existing reports visible via new admin endpoint; old rows preserved.
- [ ] **3.5 Admin triage page** — `apps/web/src/app/(dashboard)/dashboard/admin/abuse-reports/page.tsx` listing open/triaged/resolved with filter; row action: triage / resolve / dismiss. Calls existing `PATCH /v1/admin/abuse-reports/:reportId`. Requires owner-tier auth + step-up 2FA per `CLAUDE.md` §5.4. → **Verify:** can triage a seeded report end-to-end; audit-log row written.
- [ ] **3.6 Auto-suspension hooks** — when a project gets `severity=critical` + 2+ confirmed reports within 24 h, project-state-machine flips to `suspended`; suspension middleware (already mounted) blocks mutations and surfaces a banner. → **Verify:** scripted scenario suspends a sandbox project; dashboard banner appears; resolve report → state returns to `active`.

### C. Rate-limit rollout

- [ ] **3.7 Tier-aware rate limits on remaining mutate routes** — extend `RATE_LIMITS_BY_TIER` to env writes, member mutations, billing checkout; wire `rateLimit.limit` accepting a dynamic fn (already shipped) onto each route. → **Verify:** automated test exercises each route at free/pro/team and gets 429 at the right thresholds.

### D. AI differentiator

- [ ] **3.8 AI schema generator** — 🔒 Ollama on DGX (`BRIVEN_OLLAMA_URL`). Endpoint `POST /v1/ai/schema/draft` takes a prompt, calls Ollama with a system prompt sourced from `MIGRATION.md` examples + the schema DSL grammar; returns `{ schema: string, warnings: string[] }`. Onboarding flow renders draft → user edits → deploy. → **Verify:** prompt "blog with users, posts, comments" yields a compilable `schema.ts`; deploy round-trips successfully.

### E. Beta infra

- [ ] **3.9 Private Discord setup** — J creates server, channels (`#announcements`, `#feedback`, `#bugs`, `#showcase`), invite link gated behind beta accept. → **Verify:** invite link surfaced in `/dashboard/settings` only for beta-accepted users.
- [ ] **3.10 (Stretch) Migrate mavi finans** — only after 60+ continuous days clean uptime across Phase 2 migrations. Regulated fintech, zero tolerance. → **Verify:** uptime evidence linked; rollback rehearsed twice.

---

## Phase 4 — Public beta → GA (10 days, end-May 2026)

Exit when: GHCR images cut, self-host installs work for an external operator, status page lives on `status.briven.tech`, launch content shipped, 3 case studies published.

- [ ] **4.1 Commercial-licence carve-out terms** — J drafts `docs/LICENSE-COMMERCIAL.md` updates: which packages are AGPL vs MIT, the commercial-use trigger (e.g. multi-tenant SaaS), pricing schedule. → **Verify:** lawyer review tag in commit; ADR captures decision.
- [ ] **4.2 Release cut** — tag `v0.1.0` on `main`; publish 5 services × 2 arches. Post Konnos migration the canonical remote is `code.konnos.org/flndrn/briven` and the GitHub copy is a `--keep-github` mirror. Two viable paths:
  - **(a) Forgejo Actions** — port `.github/workflows/release-image.yml` into `.forgejo/workflows/release-image.yml`; push images to the Konnos package registry at `code.konnos.org/flndrn/-/packages/container/briven-*` (or the configured registry host).
  - **(b) Dual-push** — keep the existing `.github/workflows/release-image.yml` firing on the GitHub mirror (tag both remotes); images continue to land at `ghcr.io/flndrn-dev/briven-*`. Lowest-risk path; revisit when Forgejo Actions is wired.
  → **Verify:** SBOM + provenance attestations visible on the package page; a fresh `docker pull` of `briven-api:0.1.0` from the chosen registry works from a clean host.
- [ ] **4.3 External self-host validation** — recruit 1 external operator; walk through `infra/dokploy/` README on a clean VPS. → **Verify:** operator reports a running stack within 30 min; install bugs filed and closed.
- [ ] **4.4 Status DNS cutover** — Cloudflare DNS for `status.briven.tech` → kvm; Traefik labels in `apps/docs` compose mount the status page at the apex; redirect `docs.briven.tech/status` → `status.briven.tech`. → **Verify:** `curl -sI https://status.briven.tech` returns 200; redirect chain from the old URL ends at the new one.
- [ ] **4.5 Incident-history stream + RSS** — depends on alertmanager → Discord pipeline being live. Persist alertmanager events to an `incidents` table; render `/incidents` page + `/incidents.rss`. → **Verify:** a synthetic incident appears on the stream within 60 s and in the RSS within one poll cycle.
- [ ] **4.6 AI docs assistant** — `apps/docs` ships a `/ask` widget calling Ollama via `BRIVEN_OLLAMA_URL` with retrieval over `docs/**/*.md` + `apps/docs/src/app/**/*.{md,mdx,tsx}`. Rate-limited per IP-hash. → **Verify:** "how do I migrate from Convex" returns a coherent answer with citations.
- [ ] **4.7 Launch content** — J writes: launch blog post on `briven.tech/blog/launch`, Show HN copy, Product Hunt assets (`assets/launch/`). → **Verify:** blog post live; HN + PH drafts in `docs/launch/`.
- [ ] **4.8 3 publicly-linked case studies** — J + first 3 customers; each is a dashboard-published case study at `briven.tech/case-studies/<slug>`. → **Verify:** 3 case-study pages live and linked from the homepage.
- [ ] **4.9 GA sign-off** — close `BUILD_PLAN.md`, archive `BUILD_PLAN_STATUS_*.md`, publish `v1.0.0` GA announcement. → **Verify:** GA tag, GA announcement post, GA pricing toggled in dashboard.

---

## Cross-cutting (rolling, fold into the phase that needs them)

- [ ] **C.1 Real lint in 13 stub packages** — add `eslint` + `typescript-eslint` to `@briven/config`; per-package `eslint.config.js`; replace `echo 'lint wired in phase 1'`; expect a fix-violations cascade on first run. → **Verify:** `pnpm -r lint` exits 0 across the monorepo; CI `--max-warnings 0` everywhere except `apps/studio` (no source yet).
- [ ] **C.2 Promote duplicated `metrics.ts`** — fold `apps/api/src/metrics.ts`, `apps/runtime/src/metrics.ts`, `apps/realtime/src/metrics.ts` into `@briven/shared/observability/metrics` registry. → **Verify:** `/metrics` output unchanged on each service; registry single-sourced.
- [ ] **C.3 Postgres-exporter rollout** — merge `infra/observability/postgres-exporter.compose.yml` into the data-plane compose; create `briven_metrics` role with `pg_monitor` grant; set `POSTGRES_EXPORTER_DATA_SOURCE_NAME`. → **Verify:** postgres-health Grafana dashboard populates within 60 s of deploy.

---

## Done When

- [ ] Every Phase 0–4 checkbox above is ticked
- [ ] `docs/TODO.md` "Aggregate timeline" table shows all phases ✅
- [ ] `v1.0.0` tag on `main`; GA announcement live on `briven.tech/blog`
- [ ] 25+ paying customers and €2k+ MRR per `BUILD_PLAN.md` GA criteria

## Notes

- All env vars carry the `BRIVEN_` prefix per `CLAUDE.md` §4.1.
- Shared-Docker-host hygiene rules in `docs/DOCKER.md` are non-negotiable for every infra task above. No `docker_sd_configs`, no socket bind-mounts, no host polling.
- Brand: lowercase `briven` everywhere; dark-only; "built with ♥ in Flanders" in every footer with the heart in red.
- Privacy: no emails / IPs in logs, dashboards, or CLI output per `CLAUDE.md` §5.1. Redact at the boundary.
- Update the checkbox state on this file in the same PR that closes the work — do not let this doc drift.
- **Party confirmation required before any phase is marked complete or its build is started.** No phase transitions, no checkbox flips from `[ ]` to `[x]`, and no implementation work on a new phase happens until J explicitly approves. Claude (or any agent) must pause at every phase boundary, summarise what is done vs outstanding, list the exit-criteria evidence, and wait for an explicit "approved" / "proceed" from J. Implicit approval (silence, "ok", emoji) does not count — J must name the phase being signed off (e.g. "Phase 1 approved").
