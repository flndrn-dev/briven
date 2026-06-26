> ⚠️ SUPERSEDED (2026-06-26) — describes an abandoned architecture (MySQL-mode Dolt detour and/or full Supabase-services stack). Current truth: SPEC.md + docs/BUILD_PLAN.md + docs/ADR/0002.

# Briven Backend Fork — Canonical Brief

> **For Claude Code:** Read this file in full at the start of every session. Read it before any other repo file. Follow the rules in `CLAUDE.md` Build Protocol section as well. This brief is the single source of truth for the backend fork project. Do not deviate. Do not propose alternative architectures. Do not refactor scope outside this brief.
>
> **For J:** Save this at the repo root as `BACKEND_FORK_BRIEF.md`. Reference it in every Claude Code prompt: *"Follow BACKEND_FORK_BRIEF.md and CLAUDE.md Build Protocol. We are on Phase N. State your session opening before any code."*

---

## 1. What is already built and what is OUT OF SCOPE

The Briven control plane at `briven.tech/dashboard` is **already built and works**. The following pages, their routes, their components, their styles, their database tables, and their tests are out of scope for this project:

- `/dashboard` (overview page with project list, quick actions, recent activity)
- `/dashboard/projects` (projects list)
- `/dashboard/teams` (org and teams management)
- `/dashboard/billing` (Polar.sh integration, plan management, usage caps, invoicing)
- `/dashboard/settings` (account, profile, KYC, GDPR sign-in log, danger zone)
- All auth flows including OAuth Google + GitHub
- All control plane database tables (users, orgs, projects, billing, invitations, audit log)

**Hard rule:** You may not modify any file in the control plane app for this project. You may read these files to understand patterns (auth session shape, styling tokens, brand colors). You may not write to them. If a control plane change appears necessary, stop and raise it to J as a question.

The terminal/monospace aesthetic of the existing control plane (lowercase headers, dark background, green accents, mono font throughout, BETA V1 badge) is the **target visual language** for everything this project produces. The forked Supabase Studio must end up looking like the existing control plane, not like Supabase.

---

## 2. What this project delivers

When a user clicks on a project card in `/dashboard/projects`, they need to land in a **per-project Studio** that lets them:

- Manage tables (create, alter, drop)
- Insert, update, delete row data (CRUD on actual table data — the missing piece today)
- Run arbitrary SQL
- Manage Postgres roles and RLS policies
- Manage auth users scoped to that project
- See logs and metrics
- Manage API keys (anon, service_role)
- Storage management (later phase)
- Edge functions (later phase)

This per-project Studio is forked from `github.com/supabase/supabase` (the `apps/studio/` directory inside that monorepo), rebranded 100% to Briven, and deployed at `studio.briven.tech`. The per-project Postgres infrastructure (Postgres + PostgREST + GoTrue + Realtime) is the Supabase docker-compose stack from `github.com/supabase/supabase/tree/master/docker`, also rebranded.

When the project is complete, a new flndrn product should be able to install `@briven/cli`, run `npx briven dev`, authenticate against the control plane, link to a project, and immediately have a working Postgres backend with REST API, real-time subscriptions, generated types, and Studio access — equivalent to `npx supabase init && supabase start` but as Briven.

---

## 3. Architecture (locked)

```
User browser
    │
    ├──> briven.tech/dashboard
    │       (existing control plane — OUT OF SCOPE — do not touch)
    │       │
    │       └── "open project" click on a project card →
    │
    └──> studio.briven.tech/project/[ref]
            (forked + rebranded Supabase Studio, hosted as a separate Next.js app)
            │
            └── talks to per-project API gateway:
                api.briven.tech/[ref]/rest/v1/...     (PostgREST)
                api.briven.tech/[ref]/auth/v1/...     (Briven Auth, forked from GoTrue)
                api.briven.tech/[ref]/realtime/v1/... (Realtime)
                api.briven.tech/[ref]/storage/v1/...  (Storage — later phase)
```

**Per-project isolation model:** decided in Phase 1, not assumed here. Three candidates are: (a) shared Postgres cluster with one logical database per project, (b) shared Postgres cluster with one schema per project, (c) one Postgres container per project. Phase 1 produces a recommendation; J approves before Phase 2 starts.

**Session sharing:** control plane and studio.briven.tech share session via signed cookie on the `.briven.tech` parent domain. The cookie format and signing key are defined by the existing control plane and read by the studio — never the other way around.

---

## 4. Hard rebrand requirements (100% means 100%)

After the rebrand, the following must be true on every user-facing surface and every machine-readable surface:

### Visible to humans (browser)

- Every occurrence of "Supabase," "supabase," "SUPABASE" replaced with the Briven equivalent
- Every Supabase logo, favicon, OG image, social card replaced with Briven assets
- Every Supabase brand color replaced with Briven brand tokens (sourced from the existing control plane's CSS variables)
- Every Supabase link in docs/UI replaced with a Briven equivalent or removed
- The visual language matches the existing control plane: lowercase headers, mono font, dark background, green accent, terminal aesthetic. Studio screens that look "like Supabase but with Briven written on them" do not pass this rule.

### Visible to machines (network, headers, logs)

- HTTP response headers: no `Server: postgrest/...`, no `X-Powered-By: supabase`, no other identifying headers. Set via reverse proxy.
- API error message bodies: scrubbed of "supabase" references
- Internal schema names: `_supabase_*` renamed to `_briven_*`
- Generated JWT issuers: `supabase` → `briven`
- Container names in docker-compose: `supabase-*` → `briven-*`
- Environment variable prefixes: `SUPABASE_*` → `BRIVEN_*`
- npm package names in published artifacts: `@supabase/*` forks published as `@briven/*` on a private registry

### Repository-level hygiene

- The forked Supabase code lives at `apps/studio/` (for the Studio fork) and `infra/` (for the docker-compose fork). The original Supabase clone is preserved read-only at `_reference/supabase/` for Claude Code to read but never to modify.
- Commit history of `_reference/supabase/` is not merged into the main branch history (git submodule, or vendored snapshot)
- The repo's public-facing README, package.json, license file all describe Briven, not Supabase. Apache 2.0 license is preserved per its terms with the original copyright notice retained in `_reference/` and the rebrand work adding a separate Briven copyright notice on the forked files.

### Forbidden patterns (existing flndrn hard rules)

- No email addresses in any UI, log, error message, test fixture, or example transcript
- No IP addresses surfaced client-side
- No exposed secrets
- No Drizzle, no Prisma, no ORM — raw parameterized SQL only
- No Coolify — Dokploy only
- Stack lock: Next.js 16, React 19, Tailwind v4, shadcn/ui, Motion, lucide-animated for UI icons, react-icons/ri for social/brand icons only

---

## 5. Phases — one per session, demo-or-blocker, no advancement without J approval

### Phase 0 — Clone + reference setup (RESEARCH session, read-only)

- Clone `https://github.com/supabase/supabase` into `_reference/supabase/`
- Vendor as a snapshot or add as a git submodule (recommend snapshot for stability)
- Do not modify any file in `_reference/supabase/` in this or any future session
- Update `.gitignore` and CODEOWNERS so the reference tree is excluded from PR review noise

**Demo:** `ls _reference/supabase/apps/studio/` from the repo root returns the file listing of the Supabase Studio source. `git status` is clean. No file outside `_reference/supabase/` and `.gitignore` was modified.

### Phase 1 — Inventory + architecture decision (RESEARCH session, read-only)

Produce `BACKEND_FORK_PLAN.md` at the repo root containing these sections, in order:

1. **Services in scope.** Exact list of services from `_reference/supabase/docker/docker-compose.yml` we will run as Briven internal services. For each, note: keep / replace / defer.
2. **Per-service rebrand inventory.** For each service: env var prefix changes, container name changes, server header strips, internal schema renames.
3. **Studio rebrand inventory.** A full grep across `_reference/supabase/apps/studio/` for every case-insensitive occurrence of "supabase," grouped by:
   - User-visible strings (UI labels, headers, page titles)
   - Brand assets (logos, favicons, images)
   - URL/link references
   - Variable names, function names, type names
   - Internal comments
   For each group, count occurrences and estimate rebrand effort.
4. **Visual rebrand inventory.** A list of every Studio page/screen that needs visual restyling to match the existing control plane aesthetic. Include screenshots from a local-run unmodified Studio for comparison against the existing control plane.
5. **Per-project isolation recommendation.** Recommend one of the three candidates (logical database / schema / container per project) with reasoning. Include resource cost estimate for 1, 10, 50, 200 projects.
6. **Session-sharing protocol.** Exact cookie name, signing key handoff, claim shape, expiry handling, refresh flow. Reference the existing control plane code.
7. **CLI plan.** What `@briven/cli` exposes (commands and flags), file layout it writes locally, server endpoints it calls. Borrow from `_reference/supabase/cli/` (the supabase CLI Go source) for shape.
8. **Risks.** Top 10 risks to a 100% rebrand, ranked.

**Demo:** `BACKEND_FORK_PLAN.md` exists with all eight sections, J reviews and approves before any Phase 2 work.

### Phase 2 — Studio fork into the Briven repo (EXECUTION session)

- Copy `_reference/supabase/apps/studio/` into `apps/studio/` at the repo root (a copy, not a symlink, not a submodule)
- Add to the pnpm workspace config
- Resolve dependency conflicts with the existing control plane (likely React/Next.js version alignment)
- Do not modify content yet beyond what's required to make `pnpm install` succeed
- File in scope: workspace config files only; the copied tree is bulk-created in this phase but its contents are not edited

**Demo:** From a clean clone: `pnpm install && pnpm --filter studio dev` starts the Studio on a local port, the unmodified Supabase UI loads, can connect to a local Postgres for a sanity check. Studio still says "Supabase" everywhere — that is Phase 3.

### Phase 3 — String rebrand (EXECUTION session)

- Write a single script at `scripts/rebrand-strings.ts` that performs the case-sensitive replacements:
  - `Supabase` → `Briven`
  - `supabase` → `briven`
  - `SUPABASE` → `BRIVEN`
  - `SUPA_` → `BRVN_`
  - `supa_` → `brvn_`
- Apply only to `apps/studio/` tree, never to `_reference/`
- Exclude binary files, lockfiles, and any file under `node_modules/`
- Commit the script and its output as a single mechanical change

**Demo:** Studio runs (`pnpm --filter studio dev`), browser shows "Briven" in the page title, header, footer, and every visible string. A grep across `apps/studio/` for "supabase" (case-insensitive) returns zero results outside comments that are explicitly marked as historical references.

### Phase 4 — Brand asset rebrand (EXECUTION session)

- Replace every logo, favicon, OG image, social card, illustration in `apps/studio/public/` and `apps/studio/components/**/*` with Briven equivalents sourced from the existing control plane assets
- Brand colors swapped to Briven tokens (CSS variables imported from the control plane shared package)
- The Briven "BETA V1" badge replicates from the control plane

**Demo:** Screenshot comparison of three Studio screens (login, table editor, SQL editor) before and after. No Supabase branding visible anywhere.

### Phase 5 — Visual restyling to match control plane aesthetic (EXECUTION session, may span multiple sessions; one screen per session)

The current Supabase Studio uses a different visual language than the existing control plane. Each session in this phase restyles one Studio screen to match the lowercase-mono-terminal aesthetic of the existing control plane.

**Order:** login → project home → table editor → SQL editor → auth users → API settings → logs → settings.

**Demo per session:** screenshot of the restyled screen side-by-side with the equivalent control plane screen. Visual language is consistent — same fonts, same color tokens, same component shapes, same lowercase header style.

### Phase 6 — Docker-compose stack rebrand (EXECUTION session)

- Copy `_reference/supabase/docker/` into `infra/` 
- Rebrand container names, env var prefixes, network names per the rules in section 4
- Update server headers via the included Kong reverse-proxy config (or replace Kong with a lighter alternative documented in Phase 1)
- Strip identifying response headers and error message strings

**Demo:** `docker-compose up` from `infra/` brings up the full Briven backend stack. `curl` against any endpoint returns headers and error messages that contain zero references to Supabase, GoTrue, PostgREST by name, or any other underlying component identifier.

### Phase 7 — Per-project provisioning integration (EXECUTION session)

- Wire the control plane's existing `project.create` event to the per-project provisioning logic
- When a project is created in the control plane, a per-project backend is provisioned per the model decided in Phase 1
- The project record stores the project ref and the endpoints needed to talk to its backend
- Studio at `studio.briven.tech/project/[ref]` resolves the ref to the right backend

**Demo:** Click "+ new project" in the control plane → project provisions → click the project card → land on `studio.briven.tech/project/[ref]` → see the empty Studio for the new project → create a table → insert a row → row appears in the table editor → query it via REST from a separate curl call → success.

### Phase 8 — CLI integration (EXECUTION session, one command per session)

The `@briven/cli` package is built from scratch in the Briven repo (it is small enough not to need a fork). Commands implemented one per session: `login`, `link`, `init`, `db push`, `db pull`, `db reset`, `gen types`, `dev`.

**Demo per session:** the named command works end-to-end against a real Briven backend with the demo transcript from CLAUDE.md (sanitized: no emails, no real IDs).

### Phase 9 — Production hardening (EXECUTION session)

- pgBackRest sidecar in `infra/`, ships to Cloudflare R2 every 15 min
- Documented restore procedure in `infra/RESTORE.md`
- Health checks on every container
- Logs persisted and rotated

**Demo:** simulated full-disk failure recovered to within 15 minutes of data loss by restoring from R2 onto a fresh VPS, timed.

---

## 6. Recommended path if the fork hits an unrecoverable wall

If at any phase Claude Code encounters a blocker that cannot be resolved within the session and not with the three options in `BLOCKER.md`, the escalation path is:

1. Document the blocker in `BLOCKER.md`
2. J reviews; if the blocker is in a Studio surface, the fallback is to ship without rebranding that specific surface this round and revisit later
3. If the blocker is in the backend services (Postgres, PostgREST, GoTrue, Realtime), the fallback is to defer that service to a later phase and ship a thinner backend (e.g., REST only, real-time deferred)

Under no circumstances should a phase be claimed complete with the blocker unresolved and undocumented.

---

## 7. First action for the very first session

State the session opening per CLAUDE.md Build Protocol:

1. Phase 0
2. Session type: Research, read-only
3. Demo: `_reference/supabase/apps/studio/` exists with the Supabase Studio source, `git status` clean except for `.gitignore` updates

Then execute Phase 0. Stop after the demo passes. Wait for J to confirm before moving to Phase 1.

---

## 8. Out-of-scope reminders, restated

- The existing control plane is **off limits** for this project. Do not refactor, restyle, or restructure any of its files.
- Plan generation outside of `BACKEND_FORK_PLAN.md` and `BLOCKER.md` is forbidden per CLAUDE.md.
- One file per session, demo-or-blocker, no third state.
- Every example transcript in any markdown file produced under this project must be sanitized of emails, IPs, real user identifiers, real project references.
