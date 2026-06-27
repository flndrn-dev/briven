---
title: "Briven → production-ready for ISY — sprint plan"
slug: briven-sprint-plan
status: building
created: 2026-06-27T10:00:00Z
modified:
  - 2026-06-27T10:00:00Z — created from BRIVEN-BUGS-REPORT.md (one-pass fix plan)
  - 2026-06-27T10:05:00Z — Sprint 0 (smoke alarm) complete: compat + full-loop alarms green against live DoltGres, stale MySQL test rewritten, CI wired
  - 2026-06-27T10:30:00Z — Sprint 1 (Batch A safe plug-swaps) code-complete: S1.1–S1.8 fixed + proven (40 pass/0 fail on live DoltGres); S1.9 realtime auth code-done, commit pending
sessions:
  - bb266471
agents: []
commits: []
backRefs:
  - BRIVEN-BUGS-REPORT.md (the full bug catalogue, file:line + fix per item)
  - briven-realtime-production-ready.html (the technical driver plan; real-time engine = its Phase 4)
forwardRefs: []
---

# 🐟 Briven → production-ready for ISY — sprint plan

## The story (read this first)

Briven is like a house that was **half-renovated**. The new database (DoltGres) uses a
slightly different brand of **plug socket** than the old one (normal Postgres). The team
rewired the rooms people use most — but the **back rooms still have the old plugs**. So
every time someone walks into a back room and flips a switch, *pop* — another "new" bug.
They were never new; they were **waiting**.

And there's **no smoke alarm**: nothing tests Briven against the *real* new database before
it goes live, so a bad plug only sparks when you — or ISY — touch it.

**The cure is not fixing plugs one at a time.** It is:

1. **Install the smoke alarm** (a test that runs Briven against the real new database).
2. **Replace every old plug in one go.**
3. **One single deploy**, then **prove ISY works live**.

That's what these sprints do, in that order.

---

## What we're fixing (the backlog, in plain words)

Each item has its exact file + line + fix in `BRIVEN-BUGS-REPORT.md`. Here it's grouped so
you can see the shape:

| Group | Plain meaning | Count |
|---|---|---|
| 🔌 Database-language mismatches | New database doesn't understand some old commands (search, truncate, upserts…) — **proven by live test** | 8 |
| ⚠️ "Wrong wiring" landmines | Back-room code still on the old plug; the worst one **breaks all customer logins** the moment it's used | 4 |
| 🔑 Login/permission drift | Your API keys get wrongly rejected on some pages (same family as the Studio bug you hit) | 2 |
| 👻 Deploy gremlin + runtime mismatches | One leftover that fires on every deploy + two places the two runtimes disagree | 3 |
| 🅿️ Half-built features | Branches, billing wallet, workflows… — **most NOT needed for ISY**, parked | (parked) |

---

## The sprints

Status markers: `[ ]` not started · `[wip]` in progress · `[x]` done (with evidence) · `[f]` failed/blocked.

### Sprint 0 — Install the smoke alarm  `[x]`  *(SAFE — touched nothing live)*
**Why:** so every plug we swap is *proven* against the real new database before it ever
reaches the live server. This is the one change that stops bugs coming back.

- `[x]` **S0.1** Real DoltGres test container (the alarm's power supply) — `infra/test/docker-compose.dolt.yml`, container up on :5433
- `[x]` **S0.2** "Compatibility" test — `apps/api/src/db/dolt-compat.integration.test.ts`: 21/21 green (13 accepted + 8 correctly-rejected probes)
- `[x]` **S0.3** "Full loop" test — `apps/api/src/db/full-loop.integration.test.ts`: provision → committed write → **HEAD advances** (live-update fires) → read back, via the REAL data-plane helpers
- `[x]` **S0.4** Rewrote the misleading "MySQL" unit test → `apps/api/src/services/studio.test.ts` now asserts the real Postgres SQL (11/11 green; was a fake-green)
- `[x]` **S0.5** Wired the alarm into Codeberg's CI — `.forgejo/workflows/ci.yml` `quality` job now runs a DoltGres service + sets `BRIVEN_DATA_PLANE_URL` so the alarms RUN, not skip. *(The `.github/workflows/` GitHub copy was reverted — wrong robot for Codeberg.)* ⚠️ Written + correct, but **not yet observed live**: Forgejo CI only fires once a runner is registered (the repo never had one) — until then the **local alarm run before deploy is the real net**.

**Done — evidence:**
- With DoltGres: **33 pass, 0 fail** (22 alarm probes + 11 unit).
- Without a database: **11 pass, 25 skip, 0 fail** — alarms self-skip, normal run stays green.
- Bidirectional: "accepted" probes throw if the engine rejects them; "rejected" probes throw if the engine accepts them → a real regression trips the alarm either way.

---

### Sprint 1 — Safe plug swaps (Batch A)  `[x]` code-complete  *(low risk — each verified on the alarm)*
**Why:** these are small, contained fixes. With the alarm in place we swapped them quickly
and *saw* each one pass.

- `[x]` **S1.1** Case-insensitive search → `lower(col) LIKE lower($n)` (`studio.ts` buildFilterClauses) + unit test updated
- `[x]` **S1.2** Removed the unsupported `SET LOCAL` lines in the SQL runner (`studio.ts` executeQuery)
- `[x]` **S1.3** TRUNCATE = plain `TRUNCATE` (dropped RESTART IDENTITY); **bonus:** probe found `CASCADE` is also unsupported → cascade now rejected with a clear error
- `[x]` **S1.4** Index list rebuilt on `information_schema.statistics` (the pg_index/array_position join DoltGres rejected is gone)
- `[x]` **S1.5** `vector` columns now throw a friendly "coming with LanceDB" error early (`packages/schema`) + test
- `[x]` **S1.6** Inline `DELETE … RETURNING` implemented to match the isolate executor (`apps/runtime` query-builder)
- `[x]` **S1.7** Dead NOTIFY trigger removed from create_table (`schema-apply.ts`); drop_table still cleans up old ones; tests updated
- `[x]` **S1.8** Snapshots filter → `left(table_name,8) <> '_briven_'` (DoltGres-safe). *(Found a twin at `usage.ts:192` → folded into S2.2.)*
- `[wip]` **S1.9** Realtime WS auth fix is code-complete + typechecks — **not yet committed** (holding for the Sprint 3 batch, or commit now on your say-so)

**Done — evidence:** api typecheck 0 errors; runtime + schema + realtime typecheck 0 errors; **api Sprint-1 tests against live DoltGres: 40 pass / 0 fail** (`src/db/*.integration.test.ts` + `src/services/studio*.test.ts` + `schema-apply.test.ts`); schema vector test green. Nothing deployed — all local.

---

### Sprint 2 — The landmines (Batch B)  `[ ]`  *(the big, important ones)*
**Why:** these are the back-room plugs that *will* spark for ISY and for real customers.
Bigger changes, so they get their own sprint — still each proven on the alarm.

- `[ ]` **S2.1** Customer logins re-wired onto the correct plug + correct database (the worst landmine)
- `[ ]` **S2.2** "Storage used" counter reads the right database (was silently always 0)
- `[ ]` **S2.3** Case-insensitive emails without the missing "citext" type
- `[ ]` **S2.4** Upserts (insert-or-update) rewritten to the form the new database accepts
- `[ ]` **S2.5** Admin list pagination rewritten (row-tuple cursors)
- `[ ]` **S2.6** A brand-new project's database gets created before its first write (runtime side) — **needed for ISY's first write**
- `[ ]` **S2.7** API keys stop getting wrongly rejected on /env, /db, /logs, /usage, /export (login drift)
- `[ ]` **S2.8** The auth secret is *required* at startup (no forgeable keys)
- `[ ]` **S2.9** Retire the old plug code entirely, so this whole class of bug can't return

**Done when:** every item green on the alarm, including a fresh-project create→write→login. *(evidence here)*

---

### Sprint 3 — One deploy + prove ISY live  `[ ]`  *(⛔ the ONLY place I pause for your OK)*
**Why:** all the above is local and safe. Pushing to the live server is the one risky step,
so I stop and ask you first.

- `[ ]` **S3.1** ⛔ **Ask flndrn** for the single live rebuild (I'll explain the blast radius first)
- `[ ]` **S3.2** One rebuild + deploy (batched — everything above in a single shot)
- `[ ]` **S3.3** Confirm the live build is the new one (check the build id)
- `[ ]` **S3.4** Prove ISY live: create the tables → write a row → read it → see a live update → fresh-project login works

**Done when:** ISY runs the full loop against live Briven, on screen. *(evidence: screenshots)*

---

## 🅿️ Parking lot (NOT now — not needed to get ISY live)
Listed so nothing is forgotten, deliberately deferred:
branches (stub) · workflows/automation (stub) · prepaid wallet billing (not built) ·
SLA auto-credit (stub) · export/import rows · hard tier limits · Polar metering push ·
the broken old Studio app (replaced by the web dashboard) · real-time engine hardening
(its own plan: `briven-realtime-production-ready.html` Phase 4).

---

## How you'll know it's really done (no "done by assumption")
Every sprint above is only ticked when its **Done when** check actually runs and passes —
a green test, a 200, or a screenshot — pasted right under the sprint. The smoke alarm
(Sprint 0) is what makes that possible.
