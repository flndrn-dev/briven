# HANDOFF.md — backend-fork remaining work

Successor doc to `BACKEND_FORK_BRIEF.md` + `VERIFICATION_AUDIT.md`. Captures what is **not yet working** end-to-end after the 10-phase backend fork, and the minimum sequence to make a real "create a database with tables and data" demo possible.

This file is the load-bearing source for any future Claude Code session that resumes backend-fork work. It is **not** a substitute for `road-to-ga.md` (which tracks the broader GA plan and must only be flipped with evidence per the phase-approval rule).

Last update: 2026-05-22.

---

## Target architecture (how briven would have to work end-to-end)

```
user browser
    │
    ├─ briven.tech/dashboard                       [control plane — shipped]
    │      ├─ Better Auth (Google/GitHub/Discord)
    │      ├─ projects table in meta DB
    │      ├─ + new project click → createProject():
    │      │      1. INSERT row in meta DB
    │      │      2. CREATE SCHEMA proj_<id> in shared data plane
    │      │      3. CREATE ROLE proj_<id>_owner
    │      │      4. atomic rollback on failure
    │      └─ "open project" click →
    │
    └─ studio.briven.tech/project/[ref]            [forked Studio — NOT YET WORKING]
           ├─ reads session cookie from .briven.tech
           ├─ resolves [ref] → schema + connection details
           ├─ MUST inject Accept-Profile: proj_<ref> on every REST call
           │    (gap — Studio currently single-tenant via BRIVEN_PUBLIC_URL)
           ├─ table editor / SQL editor / auth users / API keys / logs
           └─ talks to:
                api.briven.tech/rest/v1/*      → caddy → PostgREST → Postgres schema
                api.briven.tech/auth/v1/*      → caddy → gotrue
                api.briven.tech/realtime/v1/*  → caddy → realtime (WebSocket)
                api.briven.tech/pg/*           → caddy → postgres-meta
                                                        │
                                                        └─ data plane: shared Postgres
                                                           cluster, one schema per project
```

CLI side: `npx briven dev` in a user's project dir → reads `briven.json` → connects to the same `api.briven.tech` endpoints with that project's API key.

Backups: pgBackRest sidecar reads PGDATA via shared volume, pushes WAL + nightly fulls to Cloudflare R2 (config in `infra/datapane/pgbackrest/`, runbook in `infra/datapane/RESTORE.md`).

---

## Can a user create a real DB with tables + data right now?

**No.** Blockers (in order they bite):

| step | blocker |
|---|---|
| create project in dashboard | provisioning code shipped. Needs running control plane (deploy-error since 2026-05-21 19:42 UTC; root cause unknown without log paste) |
| dashboard schema created in data plane | needs `infra/datapane/compose.yml` running on a server. **Not deployed anywhere.** |
| open studio → see tables | needs studio deployed at `studio.briven.tech` + multi-tenant routing layer (gap — Studio still single-tenant) |
| create table via studio UI | needs Studio talking to `meta` service on data plane via `api.briven.tech/pg/*`. Data plane not up. |
| insert row | needs PostgREST `rest` service running + Studio injecting `Accept-Profile` header. Both gaps. |
| query row back via REST | same as above |

What works today: nothing end-to-end. Studio dev mode renders chrome on `localhost:8082` but has no backend.

---

## Minimum sequence to make the demo possible

1. **Fix the broken main-branch deploy of control plane.** Small. Need the deploy log for `deploymentId nsybaRr4kMOrxU1yHpQMv` (`composeId bZFi8peDpkrzfBPYJGCvq`) pasted from Dokploy UI to diagnose. Hypotheses logged in session: studio fork blew up build context; pnpm-workspace catalog broke install; `libpg-query` native build failed on Linux; Dockerfile `COPY` pulled in 4,028 studio files.
2. **Deploy `infra/datapane/compose.yml` as a new Dokploy compose service.** Medium. Needs `.env` populated from `infra/datapane/.env.example` (17 BRIVEN_* + 5 BRIVEN_BACKUP_*), DNS for `api.briven.tech` → new stack IP.
3. **Set `NEXT_PUBLIC_BRIVEN_STUDIO_ORIGIN=https://studio.briven.tech` on control plane.** Trivial.
4. **Deploy `apps/studio` as a new Dokploy app at `studio.briven.tech`.** Medium. pnpm-workspace pulls ~1,605 packages; build window ~10 min. macOS-only `libpg-query` failure must be re-tested on Linux.
5. **Add multi-tenant routing layer in Studio.** Medium-large, code work, no prior plan. Middleware that reads `[ref]` from URL + injects `Accept-Profile: proj_<id>` on every REST/Auth/Meta request. **This is the real gap** — without it, Studio at `studio.briven.tech` will load but every API call will hit the wrong (or no) schema.
6. **Wire pgBackRest `stanza-create` + Postgres `archive_command`** so backups actually run (see `infra/datapane/RESTORE.md` §"When restore fails", row 4). Small.
7. **Demo:** create project in dashboard → open studio → create table → insert row → query back.

Honest read: steps 1+2+3+4 take a day if nothing breaks. Step 5 is the real design + code work that was never started.

---

## Carry-over gaps from `VERIFICATION_AUDIT.md`

### Closed in session 2026-05-22

- ✅ `packages/studio/*` rebrand swept — 750 replacements across 101 files. `scripts/rebrand-strings.ts` PROTECT_PATTERNS extended to cover Postgres role names (`supabase_admin`, `supabase_functions_admin`, etc.), schema names (`supabase_functions`, `supabase_migrations`), pgbouncer metric strings (`client_connections_supabase_*`), and `github.com/supabase/*` external URLs. Reverification: `grep -ri supabase packages/studio/` count should now be ≤ 363 (the protected set).
- ✅ 3 favicon `manifest.json` files rebranded (`apps/studio/public/favicon/{,staging/,archive/}manifest.json` — note: only 3, not 4 as audit claimed; archive variant only said "App" and was untouched). `name`/`short_name`/`description` lowercased to briven.
- ✅ `apps/studio/public/deno/edge-runtime.d.ts` namespace renamed `Supabase` → `Briven`.
- ✅ `apps/studio/public/img/briven-logo.png` generated via `rsvg-convert` at 1200×1354 from the existing SVG.

### Partial — known gap remains

- ⚠️ pgBackRest entrypoint added (`infra/datapane/pgbackrest/entrypoint.sh`): idempotent `stanza-create` + initial full + `crond` foreground. compose.yml wires it. **`archive_command` still NOT set** — requires the pgbackrest binary inside the db container, which `supabase/postgres:15.8.1.085` does not ship. Closing requires a custom db image (built in CI, not on deploy host per `docs/DOCKER.md` rule 5). RPO is therefore 15 min (cron incr cadence), not seconds (WAL streaming).
- ⚠️ Caddy header strips are in place (`Server`, `X-Powered-By`, `Via`). Body scrubbing of upstream identifiers (gotrue error messages, postgrest hints) is **not** implemented — `caddy:2-alpine` lacks the `replace-response` module. Closing requires: (1) a Dockerfile that uses `xcaddy` to bake in `caddyserver/replace-response`, (2) a CI pipeline that pushes to GHCR, (3) `image:` bump in `compose.yml`. The false claim in `compose.yml:102` ("scrubs error bodies") has been corrected.

### Still open

- Quarterly real restore drill per `RESTORE.md` — blocked on stack being deployed and the first nightly full landing in R2.
- Studio session-sharing path (cookie consumer via `POST /v1/auth/get-session`) — implemented at source level only; never verified against a live control plane.

---

## Security debt — must finish before any further public exposure

All values that surfaced via the Dokploy API during the 2026-05-21 verification session must be rotated. The Dokploy API key itself must be rotated. List held outside this file (password manager). Treat the failed-deploy diagnosis as **not allowed to ship credentials in any log paste** — redact before sharing.

---

## Cross-references

- `BACKEND_FORK_BRIEF.md` — original 10-phase mandate
- `BACKEND_FORK_PLAN.md` — architectural plan (Phase 7 correction inline)
- `BLOCKER.md` — Phase 2 cross-package import blocker analysis
- `VERIFICATION_AUDIT.md` — per-phase YES/PARTIAL/NO classification + transcripts
- `infra/datapane/compose.yml` — data-plane stack (undeployed)
- `infra/datapane/RESTORE.md` — DR runbook (untested)
- `road-to-ga.md` — broader GA plan. **Do not flip backend-fork-related boxes there without verifying exit criteria per the phase-approval rule.**
