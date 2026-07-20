---
name: briven
description: Use when working on Briven — Doltgres-first version-controlled database SaaS (Postgres wire, git-for-data). Read DOLTGRES-FIRST.md before any DB/backup work.
---

# Briven

## 0. 🔴 VERY IMPORTANT — DOLTGRES-FIRST (HARD RULE, never break)

**Briven.tech is Doltgres-first.** The product **is** Doltgres (Postgres-wire, git-for-data). Every vein of the platform that holds SQL product state must run on **Doltgres**, not stock Postgres.

| Must | Must not |
|------|----------|
| Control DB = Doltgres `briven_control` | Design control plane on stock Postgres “forever” |
| Project DBs = Doltgres `proj_…` | MySQL Dolt protocol / MySQL SQL for the product |
| Driver vs Doltgres = **`pg` (node-postgres)** | **`postgres.js`** against Doltgres (wire panics) |
| DB backup story = `dolt_backup` + off-site | Primary DR = “only pg_dump on stock Postgres” |

**Full rule:** repo root `DOLTGRES-FIRST.md`. **ADR:** `docs/ADR/0004-control-on-doltgres.md`.  
Stock Postgres container = rollback artifact only. If Doltgres lacks a feature, document the gap and work around **on Doltgres** — do not re-split the brain onto Postgres.

---

**Headline:** "The database anyone can use, with a full undo button. Git for your data, no coding required."
Full spec: `SPEC.md` in the repo root. Positioning + roadmap + pricing live there — read it first.

## What it is
Hosted, version-controlled SQL database service on **Doltgres** (Postgres-wire git-for-data — **not** MySQL Dolt). Wrapped in a point-and-click UI so **non-coders** can use it. Owner: Jürgen. Goal: ~€5,000/mo recurring.

## Architecture (monorepo `apps/*`)
- `apps/api` — control plane, **Hono on Bun**; control + data SQL on **Doltgres**.
- `apps/studio` — the dashboard/IDE users live in (Next.js). The no-code surface.
- `apps/web` — marketing site (briven.tech). `apps/docs` — docs/status.
- `apps/runtime` — Deno function execution. `apps/realtime` — websocket subscriptions.
- **Engine: Doltgres** (one cluster: `briven_control` + per-project DBs). Redis (sessions/queues). **MinIO** for file storage.
- Deployed on the **France server** via Dokploy. Storage = Briven's own MinIO at `s3.briven.tech` (NOT the shared UK Garage S3 — see [[flndrn-storage-map]]).

## Current state
~70–80% built — but as a *developer* platform (Supabase-style). The missing 30% = the **non-coder experience layer** (templates, guided onboarding, visual flows, "undo" reskin, hiding dev surfaces). **Build the no-coder skin, not more engine.**

## 🔴 Hot zones — verify + ask Jürgen + explain blast radius BEFORE changing
- **Billing/payments** — `apps/api/src/services/billing.ts`, `routes/billing.ts`. Money.
- **Auth/sessions** — `apps/api/src/lib/auth.ts`, `middleware/session.ts`. Lockout risk.
- **Customer DB provisioning + Dolt data** — data loss is fatal.
- **Storage/MinIO + presigner** — `apps/api/src/lib/s3-presign.ts`.
**Rule:** before any work state how you'll verify it; after, run the checks + report.

## Key decisions (locked)
- **Engine / product line:** **Doltgres-first** (control + data plane). See `DOLTGRES-FIRST.md`. Non-negotiable.
- **Audience:** non-coders niche, NOT developers (they keep Neon/Supabase). Hide dev features behind a "Developer mode" toggle.
- **Pricing:** Free tier (free, limited) + **PREPAID wallet** for paid — load money first, usage draws down, alerts, pause-on-empty, **no postpaid/invoicing**. Usage overages draw from the prepaid balance. Needs a wallet/ledger → likely **mavi-pay** sooner than "long run".
- **Version history:** reskin Doltgres branches/merges as plain "Snapshots & Undo" for non-coders.

## ⚠️ Gotchas (real mistakes/decisions — append new ones here)
1. **S3 presigner: use Bun's native `S3Client`, never hand-rolled AWS sigv4.** The hand-rolled signer caused `SignatureDoesNotMatch` on every upload/list. Fixed in `apps/api/src/lib/s3-presign.ts` (Bun is the api runtime, so no extra dep). Credentials were never the problem.
2. **Briven's storage is France MinIO (`s3.briven.tech`), distinct from the shared UK Garage S3 (`s3.flndrn.com`).** Don't confuse them; never point Briven at the shared Garage by accident.
3. **Rate limiting reads a Cloudflare header** — a Cloudflare-forwarded-IP header bug broke rate limiting earlier. Check `CF-Connecting-IP`/forwarded-IP handling when touching rate-limit/middleware.
4. **Founder/owner comp:** `COMPED_OWNER_EMAILS` set in `billing.ts` (`getTierForOrg`/`getSubscriptionForOrg`) grants Team tier to owner emails — keep this when refactoring billing.
5. **Engine is Doltgres (Postgres wire), not MySQL Dolt and not stock Postgres.** Control + project DBs on the doltgres service. Write **Postgres** SQL/types. One **database per project** (`proj_…`, see `data-plane.ts`). Use **`pg`**, never `postgres.js`, against Doltgres. See **§0 DOLTGRES-FIRST** and `DOLTGRES-FIRST.md`.
6. **Dockerfile COPY of empty folders fails the build.** Dolt/Next builds `COPY /app/public ./public`; an *empty* `public/` isn't tracked by git (git ignores empty dirs), so the clone has no `public/` and the build dies with `"/app/public": not found`. Ensure every folder the Dockerfile COPYs has a tracked file (e.g. `public/.gitkeep`). (This exact bug hit askklara.)
7. **Don't add more developer features.** The temptation is to extend the strong 70% engine; the value + SEO lane is the non-coder skin. Resist.
8. **`apps/studio` is a Supabase fork.** It imports `@supabase/...`, uses Supabase wizard components, and many files start with `// @ts-nocheck` — so **tsc will NOT catch errors there**. Verify any studio/frontend change by RUNNING the studio, not by typecheck. Don't blind-edit it.
9. **Project-create path shape mismatch (studio ↔ api).** The studio `/new/[slug].tsx` wizard uses `useProjectCreateMutation` with **Supabase-shaped** vars (`dbPass`, `cloudProvider`, `dbInstanceSize`, `dbPricingTierId`, instance sizes, regions…) and on success does `router.push('/project/'+res.ref)`. That's NOT the briven api's clean `POST /v1/projects { name, orgId }`. **Before wiring any create-flow feature (e.g. the template picker), confirm how the studio mutation maps to the briven api and WHEN the project schema is actually ready** — `apply-template` needs the data-plane schema provisioned first. Wire + smoke-test with the stack running.
10. **API side of templates is DONE + typecheck-clean:** `apps/api/src/templates/*` (format + 4 recipes) + `services/templates.ts` (`seedTemplate`) + `POST /v1/projects/:id/studio/apply-template` in `routes/studio.ts`. Frontend picker is the only remaining Pillar-1 piece.
11. **Deploy route hardcodes `'free'` tier — always verify tier is read from DB.** `apps/api/src/routes/deployments.ts` used to call `assertFunctionCountAllowed(..., 'free')` in both POST and PATCH handlers, completely ignoring `projects.tier`. This caused `tier_limit_exceeded (402)` for all paid-tier projects once they exceeded 20 functions. Fixed by using `getProjectTier(projectId)`. Also fixed `projects.ts` create path to inherit the org's resolved tier instead of always `'free'`.
12. **Auth readiness bar (2026-07):** failing unit tests + better-auth upgrade + Redis in prod + manual checklist + agent path. SDK keys need encrypt-at-rest (`encrypted_key` / `revealAuthSdkKey`) for "copy again". Platform Studio routes use `:ref` — mount `requireProjectAuth('ref')` **per route**, not a wildcard `/platform/*` use (Hono won't resolve the param). Auth go-live: `AUTH-GO-LIVE-CHECKLIST.md`. Agents: skill `briven-auth` + `briven auth scaffold` + `examples/auth-pilot`.

## Conventions
- Deploy/manage via Dokploy (admin.loowii.com) — its tRPC API works via authed browser fetch (`application.*`, `postgres.*`, `*.deploy`, `domain.create`). `project.all` omits per-service serverId; read `application.one`/`postgres.one` per id to tell which server.
- Billing today = Polar.sh (subscription-oriented). Prepaid wallet will likely need mavi-pay or a custom ledger.

13. **STANDING RULE — "fix the failed deployment" = fix the server AND trigger ONE Dokploy deploy.** Never stop at silent SSH repair. When flndrn (or anyone) says the deployment failed / shows a red Dokploy run / "Address already in use" / Docker command failed:
   1. **Fix** on France: remove stuck `Created` containers + non-compose orphans on the briven network; get api/web/runtime/docs/realtime healthy.
   2. **Trigger one Dokploy deploy** (session login → `POST /api/trpc/compose.deploy` with composeId from `memory.md`) so the panel gets a green run. This is the panel “Deploy” button — **not** git auto-deploy.
   3. **Watch** the deploy log until `Docker Compose Deployed: ✅` (or handle network race again with rm stuck + `compose up -d --no-deps` the failed services).
   Prefer **one** deploy call (not deploy+redeploy+deploy). A healthy live site with a still-red panel is **not** done — the panel must show a successful deploy too.

14. **O.1 Deploy thrash (2026-07-20) — keep Dokploy `autoDeploy: false`.** Git push must NOT rebuild the whole stack. Full Dokploy deploy runs `compose up -d --build --remove-orphans` on every service; stacked rebuilds leave api/realtime **Dead** / `Address already in use` and public API 404s. For normal code ship: SSH France → `git pull` → `build` + `up -d --no-deps` **only the services that changed** (usually `api` and/or `web`). Use full compose.deploy only for the “failed panel → one clean green” rule (#13). Do not re-enable autoDeploy without flndrn explicit OK + load plan.

15. **Handoff to other projects only after Auth + project S3 are in order.** File: `HANDOFF-AUTH-FOR-OTHER-PROJECTS.md`. Gate OPEN = both product tracks ready. Phase 0.1 platform backup is **not** part of the gate and must not delay other apps once the gate is OPEN. Do not send konnos/mavi-pay/etc. agents to integrate while the handoff gate says CLOSED.

16. **STANDING RULE — batch work, then ONE deploy, then test (2026-07-20).** flndrn: do **not** deploy after every small change (CPU thrash + flaky site). Pattern:
    1. **Build a large chunk** locally (several related fixes/features, tests green locally where possible).
    2. **One deploy** of that chunk (prefer service-scoped build; never stack; never autoDeploy).
    3. **Then** run live/acceptance testing against production.
    Pushing git for backup is fine while autoDeploy is false; **deploy ≠ push**. Only deploy when the batch is ready or flndrn explicitly says deploy.
