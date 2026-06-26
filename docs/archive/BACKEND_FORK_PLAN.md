> ⚠️ SUPERSEDED (2026-06-26) — describes an abandoned architecture (MySQL-mode Dolt detour and/or full Supabase-services stack). Current truth: SPEC.md + docs/BUILD_PLAN.md + docs/ADR/0002.

# briven backend fork — phase 1 plan

> **Status**: Phase 1 deliverable per `BACKEND_FORK_BRIEF.md`. Research-only output. No code in `apps/`, `packages/`, or `infra/` was modified. All facts cited from `_reference/supabase/` (snapshot of `github.com/supabase/supabase`), `_reference/supabase-cli/` (snapshot of `github.com/supabase/cli`), and the existing briven control plane at `apps/web/` + `apps/api/`. Read-only.

---

## 1. Services in scope

Services from `_reference/supabase/docker/docker-compose.yml`. Per-service decision: **keep** (run in briven internal stack, rebranded), **replace** (swap for a different component), **defer** (out of scope for Phase 7 cutover; revisit later).

| service | image (pinned) | purpose | decision | reason |
|---|---|---|---|---|
| `db` | `supabase/postgres:15.8.1.085` | Postgres engine + extensions (pgsodium, pg_graphql, pg_cron, pgaudit, supautils) | **keep** | The data plane. Same image; rebrand via container name + env. |
| `auth` | `supabase/gotrue:v2.186.0` | JWT auth, sign-up/login, OAuth | **keep, but isolate** | Per-project gotrue. briven control-plane auth is Better Auth on `briven.tech`; this gotrue serves each project's own end-users. |
| `rest` | `postgrest/postgrest:v14.8` | REST API auto-generated from schema | **keep** | Core feature. Generic Postgres tool; rebrand via reverse-proxy header strip. |
| `realtime` | `supabase/realtime:v2.76.5` | WebSocket subs on Postgres logical replication | **keep** | Core feature. |
| `meta` | `supabase/postgres-meta:v0.96.3` | Schema introspection backend for Studio | **keep** | Studio depends on it. |
| `studio` | `supabase/studio:2026.04.27` | Dashboard UI | **replace with forked `apps/studio/`** | This entire project is the fork. The image is not used. |
| `kong` | `kong/kong:3.9.1` | Base reverse proxy / API gateway | **replace** | See note below. Reverse-proxy choice is part of this plan. |
| `storage` | `supabase/storage-api:v1.48.26` | File upload/download, S3-backed | **defer to Phase 9** | Per brief: "Storage management (later phase)". Plumbing exists; not in Phase 7 demo path. |
| `imgproxy` | `darthsim/imgproxy:v3.30.1` | Image transformation | **defer** | Couples to storage. Re-enable when storage lands. |
| `functions` | `supabase/edge-runtime:v1.71.2` | Deno-based edge functions | **defer to Phase 9+** | Per brief: "Edge functions (later phase)". briven has its own Deno isolate plan in `BUILD_PLAN.md`. Eventually replace rather than keep. |
| `analytics` | `supabase/logflare:1.36.1` | Logs/analytics backend | **drop** | Pulls in a second Postgres just for Logflare. briven uses Loki + Grafana per `docs/CLAUDE.md`. Logs route to Loki via filesystem tail (per `docs/DOCKER.md` hard rule). |
| `vector` | `timberio/vector:0.53.0-alpine` | Log shipper to Logflare | **drop — hard-rule violation** | Bind-mounts `/var/run/docker.sock` (line 577 of base compose). Per `docs/DOCKER.md` rule 6 + 1, this is forbidden on shared Docker hosts. briven log shipping is filesystem-based tail from `/var/lib/docker/containers/*/*-json.log`. |
| `supavisor` | `supabase/supavisor:2.7.4` | PgBouncer-style connection pooler | **keep (Phase 9)** | Optional for v1. Pool sizing matters only at scale. Document but don't ship until needed. |

### Reverse-proxy choice

Base compose uses **Kong** (`3.9.1`). Variants offer **Caddy**, **nginx**, **Envoy**. Recommendation: **replace Kong with Caddy** for briven.

Why:
- Caddy is single binary, fewer moving parts (no Lua, no plugins, no admin DB), smaller blast radius for the shared host.
- Auto-TLS via Let's Encrypt baked in (briven needs `*.briven.tech` cert; Caddy handles it natively).
- Trivially strips `Server:` header (`header_up Server ""` + `header_down -Server`); section 4 of the brief mandates this.
- Already exists as a variant (`docker-compose.caddy.yml`) — port mapping pattern established.

Not Envoy: heavier, control-plane assumptions (xDS) not needed at this scale.
Not nginx: works fine but the LetsEncrypt sidecar adds complexity.

---

## 2. Per-service rebrand inventory

Each service requires container name + env-var prefix + identifying-header treatment. Cross-references the hard rule from `BACKEND_FORK_BRIEF.md` §4.

| service | container name | env-var prefix change | response-header treatment | internal schema rename |
|---|---|---|---|---|
| `db` | `supabase-db` → `briven-db` | `POSTGRES_*` unchanged (engine var); `JWT_SECRET` → `BRIVEN_JWT_SECRET` (via env) | n/a (proxy strips at edge) | `_supabase_*` schemas (used by realtime, gotrue, logflare) renamed → `_briven_*` |
| `auth` | `supabase-auth` → `briven-auth` | `GOTRUE_*` kept (gotrue reads natively; renaming requires patching gotrue source — out of scope), wrap behind briven env: `BRIVEN_AUTH_*` → consumed by compose templating → emitted as `GOTRUE_*` | Caddy strips `Server:`. gotrue's error bodies inspected — flagged as Risk #2 below. | gotrue uses `auth` schema in Postgres; no rename needed (generic name). |
| `rest` | `supabase-rest` → `briven-rest` | `PGRST_*` kept (native); briven wrappers `BRIVEN_REST_*` | Caddy strips `Server: postgrest/...`. | n/a |
| `realtime` | `supabase-realtime` → `briven-realtime` | `API_JWT_SECRET` + `DB_*` kept; wrap via `BRIVEN_REALTIME_*` | Caddy strips `Server:` and `X-Powered-By`. | `_realtime` schema retained (already neutral); `_supabase_realtime` (if any) → `_briven_realtime` |
| `meta` | `supabase-meta` → `briven-meta` | `PG_META_*` kept; wrap via `BRIVEN_META_*` | Caddy strips | n/a |
| `studio` | `supabase-studio` → `briven-studio` | `STUDIO_*` + `SUPABASE_*` → `BRIVEN_*` (controlled by us via fork) | Next.js controls own headers; remove `X-Powered-By: Next.js` via `poweredByHeader: false` in `next.config.ts` of forked studio | n/a (rebrand happens at source) |
| `kong` → `caddy` | n/a | n/a | Caddy `Caddyfile` strips `Server`, `Via`, and any upstream identifying headers. Adds `Server: briven`. | n/a |
| `supavisor` | `supabase-pooler` → `briven-pooler` | `POSTGRES_*` + `SECRET_KEY_BASE` kept; wrap via `BRIVEN_POOLER_*` | n/a (TCP, not HTTP) | n/a |

Schema-level renames are limited to **DB-side** identifiers. Image internals (gotrue/postgrest source) are NOT patched — patching breaks upgrade paths. The rebrand contract is: **at every network boundary leaving the briven trust zone, no string "supabase" appears**. Edge stripping at the Caddy layer enforces this for headers; the studio fork enforces it for HTML and JS bundles.

### Hard rule per docs/DOCKER.md

Every service in the rebranded compose file must include:

```yaml
logging: *briven-logging
```

This anchor (`x-logging: &briven-logging`) caps each container at `max-size: 10m`, `max-file: 3`. Phase 6 PR will not merge without this.

---

## 3. Studio rebrand inventory

Grep results against `_reference/supabase/apps/studio/` (Next.js 15.x app, **pages router** at `pages/`, not app router). Total files: **4,028** (`.tsx`: 1,971 / `.ts`: 1,619 / `.svg`: 229 / `.png`: 156 / `.md`: 41 / `.json`: 12). **No i18n**.

### Buckets

| bucket | files | matches | rebrand effort | notes |
|---|---|---|---|---|
| **1. User-visible strings** | 34 | 45 | small | Most are header copy, promo banners (`GrafanaPromoBanner`, `AlphaNotice`), auth dialogs. Mechanical replace. |
| **2. Brand assets** | 212 | n/a | medium | Logos (`public/supabase-logo.svg`, `public/img/supabase-{dark,light}.svg`, `public/img/supabase-logo.png`), favicon, OG images. **All inline-SVG branding is in external `public/` files** — no `<svg>` markup with "supabase" inside `.tsx`. Replace files; references update via filename change in one or two `Image` props. |
| **3. URL/link references** | 136 | 322 | medium | `https://supabase.com` x30, `https://*.supabase.co` x40+, `https://docs.supabase.com` x3, `https://discord.supabase.com` x4, `https://status.supabase.com` x11, `https://supabase.io` x1. Bulk in `csp.ts`, `next.config.ts`, support menu, evals. CSP is risk #5. |
| **4. Identifier names** | many | ~2,100 | **large** | 86 unique identifiers. Top: `supabase` (111), `supabasejs` (65), `supabaseUrl` (63), `supabaseKey` (59), `supabaseClient` (49). Renaming changes public API of helpers/hooks (`useSupabaseClient` → `useBrivenClient`). Mechanical but high blast radius. |
| **5. Comments** | 177 | 429 | small | Sentry IDs (`SUPABASE-APP-*`), inline notes. Most are leave-as-is candidates if explicitly marked "historical reference"; rest get the rename. |

### Phase 3 script

A single `scripts/rebrand-strings.ts` does the case-sensitive sweep across `apps/studio/` (post-copy in Phase 2):

```
Supabase  -> Briven
supabase  -> briven
SUPABASE  -> BRIVEN
SUPA_     -> BRVN_     (env var prefix)
supa_     -> brvn_     (lowercase var prefix; conservative — flag false positives in PR diff)
```

Exclude: `node_modules/`, `.next/`, `dist/`, lockfiles, `_reference/`, binary files.

### Out-of-band names

Two identifiers don't fit the mechanical rename:
- `@supabase/supabase-js` — published npm package. We cannot rename the package; we can vendor it or wrap it. Recommendation: **wrap** in `packages/briven-js/` that re-exports `createClient` from the upstream package. Studio imports from `@briven/js`. Public API surface stays familiar to anyone migrating from supabase.
- `postgres.supabase.co` style hostnames — already covered by URL bucket. Studio reads its API base from env (`NEXT_PUBLIC_BRIVEN_API_URL`), so this resolves naturally.

---

## 4. Visual rebrand inventory

The Studio's visual language differs from the existing briven control plane. Each screen below needs restyling in Phase 5 to match the lowercase-mono-terminal aesthetic of `apps/web/src/app/(dashboard)/dashboard/*`.

| order | studio screen | studio path | control-plane analog | restyle scope |
|---|---|---|---|---|
| 1 | sign-in | `pages/sign-in.tsx` (or `pages/auth/*`) | `apps/web/src/app/(auth)/signin/` | Replace entire screen. Studio shouldn't actually own sign-in (per session-sharing protocol); redirect to control plane and read cookie. |
| 2 | project home | `pages/project/[ref]/index.tsx` | `apps/web/src/app/(dashboard)/dashboard/projects/[id]/` | Header, sidebar, mono-font, lowercase headers, green-on-dark accents. |
| 3 | table editor | `pages/project/[ref]/editor` | (no analog) | Largest surface. Grid component (`components/grid/SupabaseGrid.tsx`) keeps function but loses Supabase chrome. |
| 4 | SQL editor | `pages/project/[ref]/sql` | (no analog) | Monaco-based; theme + chrome restyle. |
| 5 | auth users | `pages/project/[ref]/auth/users` | (no analog) | Per-project end-users, not control-plane users. New chrome. |
| 6 | API settings | `pages/project/[ref]/settings/api` | `apps/web/src/app/(dashboard)/dashboard/projects/[id]/keys/` (exists for briven keys) | Surface anon/service_role keys with the same key-component as control plane. |
| 7 | logs | `pages/project/[ref]/logs` | (no analog) | Logflare UI replaced w/ Loki-fed iframe or thin custom view. |
| 8 | settings | `pages/project/[ref]/settings/*` | `apps/web/src/app/(dashboard)/dashboard/settings/` | Reuse cards/sections from control-plane settings. |

### Screenshot capture — Phase 1 limitation

The brief calls for "screenshots from a local-run unmodified Studio for comparison against the existing control plane." Capturing them inside Phase 1 requires running the full unmodified Supabase docker stack + Studio next dev. That:
- Pulls 10+ images onto the dev machine, runs them locally — non-trivial setup
- Is the **Phase 2 demo** anyway ("the unmodified Supabase UI loads")

**Phase 1 ships without screenshots.** Phase 2 demo naturally produces them. Flag for J: if this blocks approval, re-open this section after Phase 2 completes and re-run with screenshot artifacts saved under `docs/visual-rebrand/`.

---

## 5. Per-project isolation recommendation

Three candidates from the brief:

| candidate | per-project unit | pros | cons |
|---|---|---|---|
| **(a) shared cluster, logical DB per project** | one Postgres database in a shared cluster | Strong namespace isolation. Standard ops. | Cross-DB queries impossible (ok). Connection pooling per-DB. Backup/restore granularity good. |
| **(b) shared cluster, schema per project** | one schema in one shared DB | Cheapest. Easy ops. | Weak isolation (one bad query, shared WAL). `search_path` foot-guns. RLS becomes the only boundary. Bad blast radius. |
| **(c) container per project** | one Postgres container | Strongest isolation. Native upgrade path. | Linear cost. 50 projects = 50 containers. Backup ops 50x harder. Disk overhead per. |

**Recommendation**: **(a) shared cluster, logical database per project**.

> **Phase 7 correction (2026-05-21)**: briven control plane was inspected and **already ships option (b)** — schema-per-project — via `apps/api/src/db/data-plane.ts` (`provisionProjectSchema()`, `schemaNameFor()` → `proj_<id>`). The `createProject()` flow at `apps/api/src/services/projects.ts:46-119` atomically creates a schema + owner role + cleanup on rollback. The recommendation above is no longer the live decision; the live decision is (b) and reversing it is a separate migration project. The (b)-vs-(a) cons listed (RLS-only boundary, `search_path` foot-guns, shared WAL noisy-neighbor) remain real risks to track. Re-open the decision before Phase 3 (external users) or before the first regulated-industry tenant lands.

### Reasoning

briven is dogfood-first through Phase 1-2 (`docs/CLAUDE.md` §3). Volumes:
- Phase 1-2 (~6 months): 1-10 projects total. All J's own products.
- Phase 3 (Oct 2026+): external users; ramp from 10 -> 200 over 12 months.

For 1-10 projects, (b) and (a) cost the same; (a) gives strictly more isolation. At 200 projects, (a) holds: Postgres can host 200 logical DBs in one cluster on a 16-core VPS without breaking a sweat (logical DBs are cheap — each is a row in `pg_database` + a directory; backing memory is paged on demand).

Where (a) struggles: **noisy-neighbor on shared buffers / WAL**. Mitigations:
- Per-DB `connection_limit` (set when CREATE DATABASE runs)
- Statement timeout enforced via per-role default
- Resource controls via Postgres role-level `SET` (cpu/mem limits in v17 via per-role GUCs)
- Move heavy tenants to a second cluster when n x p99 starts to bite; routing layer in front (Supavisor or briven's own pooler) makes this a config change, not a migration.

Where (c) wins: **regulated industries**. Phase 3+ might need HIPAA-style per-tenant DB. Flag as Risk #7 — re-open the decision then.

### Resource estimate

Single Postgres 16 cluster, 16 vCPU / 64 GB / 2 TB NVMe (briven kvm4 sizing target):

| projects | cluster cost | per-project p50 latency | notes |
|---|---|---|---|
| 1 | $0 marginal | <2 ms | dogfood |
| 10 | $0 marginal | <5 ms | dogfood + close beta |
| 50 | $0 marginal | <10 ms | early external |
| 200 | one cluster headroom strained; consider 2nd cluster | <30 ms p95 | external scale |

---

## 6. Session-sharing protocol

Auth provider is **Better Auth** (not next-auth, not custom). Cookie is **opaque session-ID**, not JWT. Studio is a **passive consumer**.

### Cookie

| attribute | production | development |
|---|---|---|
| name | `__Secure-briven.session_token` | `briven.session_token` |
| domain | `.${BRIVEN_DOMAIN}` (= `.briven.tech`) | localhost (domain-less) |
| HttpOnly | true | true |
| Secure | true | false |
| SameSite | `lax` | `lax` |
| path | `/` | `/` |
| max-age | 30 days (sliding refresh at 7 days) | same |

Source: `apps/api/src/lib/auth.ts:74-101` + `apps/web/src/proxy.ts:6-7`.

### Studio's job

```
on request to studio.briven.tech/project/[ref]:
  1. read cookie (HttpOnly so done server-side)
  2. POST ${BRIVEN_API_ORIGIN}/v1/auth/get-session w/ cookie forwarded
  3. on 200: cache session 60s, render
  4. on 401: 302 -> ${BRIVEN_WEB_ORIGIN}/signin?returnTo=studio.briven.tech/project/[ref]
  5. never set, refresh, or clear the cookie
```

### Logout

Studio "sign out" POSTs to `${BRIVEN_API_ORIGIN}/v1/auth/sign-out` with cookies, then 302 -> `${BRIVEN_WEB_ORIGIN}/signin`.

### Signing key

`BRIVEN_BETTER_AUTH_SECRET` lives in control plane env. Studio **does not need it** — it validates via API call, not local crypto. Keeps Studio's blast radius small.

### CSRF

No separate token. SameSite=lax + Origin header check at `apps/api/src/middleware/csrf.ts:115` covers it. Studio's POSTs to the control plane API include the `Origin: https://studio.briven.tech` header; control plane's trusted-origins env must include this value:

```
BRIVEN_TRUSTED_ORIGINS=https://studio.briven.tech,https://briven.tech
```

### "Open project" button (control plane -> Studio)

Control plane card click goes to:

```
https://studio.briven.tech/project/${projectRef}
```

No tokens in the URL. Cookie auto-attaches because `.briven.tech` is the cookie domain. Browser handles it.

---

## 7. CLI plan

`@briven/cli` is built from scratch in TypeScript at `packages/cli/`. **Not** a Go fork of supabase CLI. Shape borrowed from the supabase CLI (already at `_reference/supabase-cli/`).

### Commands (8, one per session in Phase 8)

| command | purpose | server endpoints called | local files touched |
|---|---|---|---|
| `briven login` | OAuth device-code flow against control plane | `POST /v1/cli/login`, poll `GET /v1/cli/login/poll` | macOS keychain / libsecret / wincred; fallback `~/.briven/access-token` (mode 0600) |
| `briven link` | Map current dir to project ref | `GET /v1/projects/{ref}`, `GET /v1/projects/{ref}/api-keys` | `briven/.temp/project-ref` |
| `briven init` | Scaffold `briven/` directory | none | `briven/config.toml`, `briven/.gitignore`, optional `.vscode/settings.json` |
| `briven db push` | Apply local migrations to remote | direct Postgres connection (via pooler) | reads `briven/migrations/*.sql`, `briven/seed.sql` |
| `briven db pull` | Generate migration from remote schema diff | direct Postgres connection | writes `briven/migrations/{timestamp}_{name}.sql` |
| `briven db reset` | Drop schema, reapply all migrations + seed | direct Postgres connection | none |
| `briven gen types` | Generate types from remote schema | `GET /v1/projects/{ref}/types/typescript` | writes `briven/types.ts` |
| `briven dev` | Local stack (Postgres + REST + Auth + Realtime) | n/a — local docker | reads `briven/config.toml` |

### Local file layout (`briven init` scaffolds)

```
briven/
  config.toml           # main config, BRVN_-prefixed keys
  .gitignore            # appends .temp/, .env
  migrations/           # SQL: 20260521120000_init.sql
  seed.sql              # optional
  functions/            # edge functions (Phase 9+)
  .temp/                # runtime state (gitignored)
    project-ref         # set by `briven link`
    postgres-version
    briven-version
  .branches/            # branch state (Phase 9+)
```

### Token format

`brvn_[a-f0-9]{40}` — 40 hex chars, `brvn_` prefix. Matches supabase's `sbp_*` shape but rebranded.

### Patterns reused from supabase CLI

- OS-keyring-first credential storage with file fallback
- TTY detection to skip interactive prompts in CI
- Dry-run flags on destructive commands
- Backoff-with-retry around Postgres connection
- Color helpers wrapped behind `briven` brand tokens (bold + lowercase; no caps)

### Patterns NOT reused (hard "no")

- **Docker socket bind-mount**: supabase CLI mounts the daemon socket into the local stack. briven CLI uses Docker SDK over TCP only when running `briven dev`, and only locally. Per `docs/DOCKER.md` rule 6.
- **Sentry traces sample rate 1.0**: supabase ships 100% sampling. briven ships off by default; opt-in via `BRIVEN_TELEMETRY=on`.
- **Hardcoded hostnames**: supabase has `db.supabase.internal` baked in. briven reads from `BRIVEN_DEV_DB_HOST` env or `briven/config.toml`.

---

## 8. Risks (top 10, ranked)

| # | risk | likelihood | impact | mitigation |
|---|---|---|---|---|
| 1 | **Identifier rename breaks Studio at runtime.** `supabaseClient`/`useSupabaseClient` are referenced ~2,100x across 4,028 files. A single missed identifier inside a string template or dynamic import bricks a page. | high | high | Phase 3 script is mechanical + case-sensitive only. Run TypeScript compiler post-rename; any `Cannot find name` error is the diff. Block PR until `pnpm --filter studio typecheck` is green. |
| 2 | **gotrue error messages leak "supabase" / "GoTrue".** gotrue's error JSON bodies are crafted in upstream Go source. They include strings like "supabase only allows X". Patching = forking the Go service. | high | medium | Caddy intercepts 4xx/5xx from `/auth/v1/*` and rewrites bodies via a small templating layer. Documented in `infra/caddy/error-rewrite.md`. Imperfect, but the cost of forking gotrue Go is higher than this scrub. |
| 3 | **`@supabase/supabase-js` npm dependency cannot be renamed.** Public package. | high | low | Wrap in `packages/briven-js/`. Studio imports `@briven/js`. Upstream package stays as a transitive dep — visible in lockfile but not in user-facing code. |
| 4 | **Phase 2 dependency-conflict with control plane.** Studio is Next.js 15, control plane is Next.js 16. Tailwind v3 vs v4. React 18 vs 19. The pnpm workspace will fight. | high | high | Phase 2 plan: pin Studio to its own React version via workspace alias; do NOT try to converge versions in Phase 2. If a shared component is needed, copy it. Converge in a later phase. |
| 5 | **CSP whitelist contains 20+ supabase domains** (`csp.ts`). Strip them and pages break. | medium | medium | Audit each CSP entry; many are for telemetry/Sentry/Vercel preview that briven doesn't use anyway. Map: keep `https://*.briven.tech`, drop `*.supabase.co` references, keep generic CDN allowances. |
| 6 | **Logflare drop leaves Studio's logs UI broken.** `pages/project/[ref]/logs` queries Logflare. We're not running Logflare. | medium | medium | Phase 5 step 7: rewrite the logs panel to query Loki via a thin proxy at `apps/api/src/routes/loki.ts`. Or iframe Grafana. Decide in Phase 5. |
| 7 | **Per-project isolation decision is wrong at scale.** Recommending logical-DB-per-project; regulated industries (HIPAA, EU data residency) may need per-container. | medium | high | The routing layer (`projectRef -> connection string`) is a config table in the meta-DB. Re-routing a project from "shared cluster A" to "dedicated container" is a row update + a `pg_dump`/`pg_restore`. Reversible. Re-open this decision before Phase 3 (external users). |
| 8 | **Studio's pages router doesn't compose cleanly with control plane's app router.** Studio is pages-router Next 15. Future shared layout work has friction. | low | medium | Out of scope. Studio stays standalone at `studio.briven.tech`. No shared layout. Cross-app shared components live in `packages/briven-ui/`. |
| 9 | **Caddy auto-TLS rate limits at Let's Encrypt** for `*.briven.tech` wildcard or 100s of subdomain certs. | low | medium | Use ZeroSSL or a single wildcard cert via Cloudflare DNS-01 challenge. Caddy supports both. Documented in `infra/caddy/tls.md` (Phase 6). |
| 10 | **`vector` log shipper is the canonical violation of `docs/DOCKER.md`** and dropping it means losing Logflare's input. Anyone copy-pasting from upstream supabase docs will re-add it. | medium | high (violates hard rule) | Phase 6 PR check: `grep -r "docker.sock" infra/` returns zero hits. CI gate. Comment in compose file explicitly says "do not re-add vector or any Docker-API log shipper — see docs/DOCKER.md". |

---

## Pre-Phase-2 gate

Items J approves before Phase 2 starts:
- [ ] Section 1: reverse-proxy = **Caddy**, not Kong
- [ ] Section 1: defer storage/functions/analytics to Phase 9+
- [ ] Section 2: `BRIVEN_*` env wrapper around `GOTRUE_*`, `PGRST_*`, `PG_META_*` rather than source patches
- [ ] Section 4: screenshots deferred to Phase 2 demo
- [ ] Section 5: per-project isolation = **logical DB per project**, single cluster
- [ ] Section 6: studio is passive cookie consumer; control plane keeps all auth surface
- [ ] Section 7: CLI is TypeScript reimpl, not Go fork; package at `packages/cli/`
- [ ] Section 8: Phase 2 won't try to converge React/Next versions

Once these eight are approved, Phase 2 begins: copy `_reference/supabase/apps/studio/` -> `apps/studio/`, add to pnpm workspace, resolve install, demo `pnpm --filter studio dev` running unmodified.
