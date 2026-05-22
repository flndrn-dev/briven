# VERIFICATION_AUDIT.md

> **Session type**: verification (read + execute, no new code).
>
> **Premise correction**: the prior session declared the backend fork
> "code-complete with live demos deferred to J." That closing is
> rejected per CLAUDE.md Build Protocol — "tests pass but demo not
> verified" is not a valid end state. This audit re-examines each
> phase's brief-stated demo, records what was actually demonstrated in
> session vs. what was declared without proof, and separates
> environment-forced deferrals from session-level choices.
>
> **Date**: 2026-05-21.
>
> **Verifier environment**: macOS workstation, no Docker installed
> (`docker --version` → `command not found`), no `colima`/`podman`/
> `lima`. Studio dev mode reachable on `localhost:8082` (orphan from
> earlier session). No briven control plane / data plane backend
> running.

---

## Top-line honest finding

The prior session's strongest claim — **rebrand is 100%** — does not survive a grep audit. The full repo carries **2,026 `supabase` hits** across `apps/`, `packages/studio/`, and `infra/`. Most are protected by design (834 `@supabase/*` npm scope refs, 437 `supabase.{com,io,co}` URLs in CSP/links — both intentionally preserved per `scripts/rebrand-strings.ts` protection rules). But the residual after subtracting both categories is **~755 hits**, distributed:

| location | hits | character |
|---|---|---|
| `apps/studio` (excluding protected) | **15** | 4 PWA manifest leaks + 1 edge-runtime namespace + 6 legit npm subpath (`stripe-experiment-sync/supabase`) + 4 comments referring back to upstream |
| `packages/studio/*` (any) | **~682** | **Phase 3 sweep was scoped to `apps/studio/` only — `packages/studio/*` was never rebranded.** This is documented in `BACKEND_FORK_BRIEF.md` §5 Phase 3 ("Apply only to `apps/studio/` tree") but the impact wasn't surfaced honestly in earlier phase summaries. |
| `apps/web/`, `apps/api/`, `apps/docs/` | 103 | mostly test fixtures + documentation referencing supabase compatibility |
| `infra/datapane/` | 21 | upstream init SQL still references `supabase_*` Postgres role names (gotrue/postgrest/realtime expect these — schema-level rename requires forking upstream sources) |

### Concrete remaining leaks worth landing before any production claim

| file | leak |
|---|---|
| `apps/studio/public/favicon/manifest.json` | `"name": "Supabase Studio"`, `"short_name": "Supabase"` — PWA install metadata. Browsers show this. |
| `apps/studio/public/favicon/staging/manifest.json` | same |
| `apps/studio/public/favicon/archive/site.webmanifest` | same |
| `apps/studio/public/deno/edge-runtime.d.ts` | `declare namespace Supabase` — TypeScript namespace for Studio's edge-runtime API surface |

The favicon manifest files were specifically excluded from `scripts/rebrand-strings.ts` (binary-extension exclusion list includes `.ico` but not `.json` — these JSON files just happened to live under `public/` which the script skips by design). Real gap.

---

## Verification matrix — per phase

### Phase 0 — clone supabase

**Brief demo (quoted)**:
> `ls _reference/supabase/apps/studio/` from the repo root returns the file listing of the Supabase Studio source. `git status` is clean. No file outside `_reference/supabase/` and `.gitignore` was modified.

**Executed in-session**: YES.

**Transcript**:
```
$ ls _reference/supabase/apps/studio/ | head -10
Dockerfile
README.md
__mocks__
app
components
csp.ts
data
docker-entrypoint.sh
eslint.config.cjs
evals

$ du -sh _reference/supabase
1.3G  _reference/supabase

$ git status --short
 M apps/docs/next-env.d.ts            # pre-existing drift unrelated to this work
 M apps/web/next-env.d.ts             # pre-existing drift
?? BACKEND_FORK_BRIEF.md              # brief itself, untracked at time of audit
```

`_reference/supabase/` does NOT appear — `_reference/` was already gitignored (commit `509ee56`). Demo passed at the time and the snapshot remains on disk.

---

### Phase 1 — inventory + architecture decision

**Brief demo (quoted)**:
> `BACKEND_FORK_PLAN.md` exists with all eight sections, J reviews and approves before any Phase 2 work.

**Executed in-session**: YES.

**Transcript**:
```
$ wc -l BACKEND_FORK_PLAN.md
317 BACKEND_FORK_PLAN.md     # includes Phase 7 correction annotation

$ grep -c "^## " BACKEND_FORK_PLAN.md
8                            # all 8 sections present
```

**Known correction landed in §5**: the recommendation (DB-per-project) diverges from briven's already-shipped reality (schema-per-project at `apps/api/src/db/data-plane.ts`). Annotation added Phase 7.

---

### Phase 2 — copy studio into apps/studio

**Brief demo (quoted)**:
> From a clean clone: `pnpm install && pnpm --filter studio dev` starts the Studio on a local port, the unmodified Supabase UI loads, can connect to a local Postgres for a sanity check. Studio still says "Supabase" everywhere — that is Phase 3.

**Executed in-session**: PARTIAL.

| component | status |
|---|---|
| `pnpm install` succeeds on a clean clone | **NOT VERIFIED FROM CLEAN CLONE**. In-session install succeeded only with `--ignore-scripts` (libpg-query native build fails on macOS 26 SDK — `strchrnul` conflict). A truly clean fetch+install on macOS 26 would error the same way. Linux build hosts may pass. Not demonstrated either way. |
| `pnpm --filter studio dev` starts on a port | YES — `Ready in 327ms` on 8082 (verified again this session, see Phase 5 probes below). |
| "Unmodified Supabase UI loads" | **NOT VERIFIED** — Studio was already rebranded in the same session that demoed Phase 2. The brief-required "before-and-after" comparison was skipped. |
| "Can connect to a local Postgres" | **NO** — no Postgres ran in any session. Studio's `BRIVEN_PUBLIC_URL=http://localhost:8000` points at the data plane Caddy port; that was never up because Docker is absent on this verifier machine. |

**Deferral classification**:
- macOS-26 build failure: **forced by environment** (kernel SDK clash, not a code issue). Linux CI likely passes.
- Postgres connection: **forced by environment** (no Docker on this box).

**Equivalent local verification**:
```
$ pnpm --version && node --version
9.12.0 / v22.22.2          # already-installed pnpm + node satisfy engines

$ pnpm tsx scripts/rebrand-strings.ts --dry-run
[dry-run] targets=apps/studio  scanned=3690  changed=581  ...
                            # source tree is parseable, walkable
```

---

### Phase 3 — string rebrand

**Brief demo (quoted)**:
> Studio runs (`pnpm --filter studio dev`), browser shows "Briven" in the page title, header, footer, and every visible string. A grep across `apps/studio/` for "supabase" (case-insensitive) returns zero results outside comments that are explicitly marked as historical references.

**Executed in-session**: PARTIAL.

| element | claim | actual |
|---|---|---|
| "Briven" in `<title>` | YES | ✓ `<title data-next-head="">Briven</title>` confirmed in served HTML this audit |
| `application-name` meta | YES | ✓ `<meta name="application-name" content="Briven Studio">` confirmed |
| Every visible string | implied YES | **NOT TRUE**. The brief's demo standard "every visible string" was never actually verified — no real browser walkthrough. HTTP probes of 8 routes captured only HTML response, not rendered UI. |
| Grep returns zero results outside comments | YES | **FALSE**. Grep against `apps/studio/` returns **15 non-protected hits** (transcript below). 4 are favicon manifest leaks (visible to browsers as PWA name), 1 is `declare namespace Supabase` in edge runtime types, 6 are intentional `stripe-experiment-sync/supabase` npm subpath references, 2 are my own globals.css comments documenting the brand override, 2 are stripe-experiment-sync imports. |

**Transcript — grep against `apps/studio/`**:
```
$ grep -ri "supabase" apps/studio --exclude-dir=node_modules --exclude-dir=.next \
    | grep -v "@supabase/" | grep -vE "supabase\.(com|io|co)" | head -20
apps/studio/styles/globals.css: * Replaces Supabase's green (--brand-default 153 60 53) with briven's
apps/studio/styles/globals.css:   * resolve to briven green rather than upstream's supabase HSL. */
apps/studio/components/interfaces/Integrations/Landing/Landing.utils.ts:import { parseSchemaComment } from 'stripe-experiment-sync/supabase'
apps/studio/components/interfaces/Integrations/templates/StripeSyncEngine/StripeSyncChangesCard.tsx:import { SchemaInstallationStatus } from 'stripe-experiment-sync/supabase'
apps/studio/components/interfaces/Integrations/templates/StripeSyncEngine/StatusDisplay.tsx:import { SchemaInstallationStatus } from 'stripe-experiment-sync/supabase'
apps/studio/components/interfaces/Integrations/templates/StripeSyncEngine/stripe-sync-status.ts:import { SchemaInstallationStatus, StripeSchemaComment } from 'stripe-experiment-sync/supabase'
apps/studio/components/interfaces/Integrations/templates/StripeSyncEngine/useStripeSyncStatus.ts:import { getCurrentVersion, parseSchemaComment } from 'stripe-experiment-sync/supabase'
apps/studio/public/favicon/staging/manifest.json:  "name": "Supabase Studio"
apps/studio/public/favicon/staging/manifest.json:  "short_name": "Supabase"
apps/studio/public/favicon/manifest.json:  "name": "Supabase Studio"
apps/studio/public/favicon/manifest.json:  "short_name": "Supabase"
apps/studio/public/favicon/archive/site.webmanifest:  "name": "Supabase"
apps/studio/public/favicon/archive/site.webmanifest:  "short_name": "Supabase"
apps/studio/public/deno/edge-runtime.d.ts:declare namespace Supabase {
apps/studio/pages/api/integrations/stripe-sync.ts:import { install, uninstall } from 'stripe-experiment-sync/supabase'
```

**Demo as brief stated it: NOT MET.** The favicon manifests and edge-runtime namespace are real visible/functional leaks.

**packages/studio/* was never rebranded.** Confirmed by:
```
$ grep -ri "supabase" packages/studio --exclude-dir=node_modules --exclude-dir=.next \
    | grep -v "@supabase/" | grep -vE "supabase\.(com|io|co)" | wc -l
682
```

Brief §5 Phase 3 scoped the sweep to `apps/studio/` only, but the demo standard "Briven in page title, header, footer, every visible string" includes UI rendered by `packages/studio/ui/` and `packages/studio/ui-patterns/` — and those still emit Supabase strings.

---

### Phase 4 — brand asset rebrand

**Brief demo (quoted)**:
> Screenshot comparison of three Studio screens (login, table editor, SQL editor) before and after. No Supabase branding visible anywhere.

**Executed in-session**: NO.

**Deferral classification**: **session-level choice + environment limit** combined. No real browser available in this verification environment (CLI only). No screenshots were ever captured before or after. The prior session declared "DEFERRED (CLI-only session)" without acknowledging that this fails the brief's explicit demo standard.

**Equivalent local verification that CAN run in-session**:
```
$ ls apps/studio/public/img/briven-* apps/studio/public/briven-*
apps/studio/public/briven-favicon.svg
apps/studio/public/briven-icon.svg
apps/studio/public/briven-logo.svg
apps/studio/public/img/briven-dark.svg
apps/studio/public/img/briven-light.svg
apps/studio/public/img/briven-logo.svg

$ curl -sI http://localhost:8082/img/briven-logo.svg
HTTP/1.1 200 OK
                                  # asset served, briven SVG returned

$ curl -sI http://localhost:8082/img/briven-logo.png
HTTP/1.1 404 Not Found
                                  # og:image PNG missing — meta tag points at nonexistent file

$ grep -l "Geist Mono\|--brand-default" apps/studio/.next/dev/static/chunks/*.css | head -1
apps/studio/.next/dev/static/chunks/[root-of-the-server]__0lwik~h._.css
                                  # CSS override is in the compiled bundle
```

**Still not equivalent to the brief's demo.** Brief requires before/after screenshots. None exist.

---

### Phase 5 — per-screen visual restyle (8 screens)

**Brief demo (quoted, per session)**:
> screenshot of the restyled screen side-by-side with the equivalent control plane screen. Visual language is consistent — same fonts, same color tokens, same component shapes, same lowercase header style.

**Executed in-session**: NO (no screenshots, ever).

**Equivalent local verification — HTTP probe of all 8 route paths**:
```
$ for path in /sign-in /project/default /project/default/editor /project/default/sql \
              /project/default/auth/users /project/default/settings/api-keys \
              /project/default/logs /project/default/settings/general; do
    echo "$path:"
    curl -sI "http://localhost:8082$path" --max-time 30 | head -1
  done
/sign-in:                              HTTP/1.1 307 Temporary Redirect
/project/default:                      HTTP/1.1 200 OK
/project/default/editor:               HTTP/1.1 200 OK
/project/default/sql:                  HTTP/1.1 200 OK
/project/default/auth/users:           HTTP/1.1 200 OK
/project/default/settings/api-keys:    HTTP/1.1 200 OK
/project/default/logs:                 HTTP/1.1 200 OK
/project/default/settings/general:     HTTP/1.1 200 OK

$ curl -sS http://localhost:8082/project/default | grep -oc "supabase\|Supabase"
3                                      # CSP-allowed URL references
```

**What this proves**: pages compile + serve, theme overrides land in the CSS bundle, sign-in redirects per Phase 5/1 design.

**What this does NOT prove**: visual parity with the briven control plane. The brief asks for a side-by-side screenshot. No screenshot was ever produced. The lowercase + mono + brand-green decisions are present in source — whether they render correctly when a human looks at the page is unverified.

**`X-Powered-By: Next.js`** leaks in dev mode — Next.js dev server doesn't honor `poweredByHeader: false` for all paths. Production build would strip it. Verified:
```
$ curl -sI http://localhost:8082/project/default | grep -i "powered\|server:"
X-Powered-By: Next.js
                                       # (no Server: header — Next dev doesn't set one)
```

---

### Phase 6 — docker-compose stack rebrand

**Brief demo (quoted)**:
> `docker-compose up` from `infra/` brings up the full Briven backend stack. `curl` against any endpoint returns headers and error messages that contain zero references to Supabase, GoTrue, PostgREST by name, or any other underlying component identifier.

**Executed in-session**: NO.

**Deferral classification**: **forced by environment**. This verifier machine has no Docker, no Docker-compatible alternative:
```
$ docker --version
zsh: command not found: docker
$ which docker podman colima lima
                                       # all absent
```

**Equivalent local verification — YAML lint + logging-cap + docker.sock audit**:
```
$ python3 -c "
import yaml
with open('infra/datapane/compose.yml') as fh: d = yaml.safe_load(fh)
print('services:', list(d['services'].keys()))
for s, c in d['services'].items():
    print(f'  {s}: logging={\"logging\" in c} healthcheck={\"healthcheck\" in c} restart={c.get(\"restart\")}')
print('docker.sock present:', any('docker.sock' in str(v.get('volumes', [])) for v in d['services'].values()))
"
services: ['caddy', 'db', 'auth', 'rest', 'realtime', 'meta', 'pgbackrest']
  caddy: logging=True healthcheck=True restart=unless-stopped
  db: logging=True healthcheck=True restart=unless-stopped
  auth: logging=True healthcheck=True restart=unless-stopped
  rest: logging=True healthcheck=True restart=unless-stopped
  realtime: logging=True healthcheck=True restart=unless-stopped
  meta: logging=True healthcheck=True restart=unless-stopped
  pgbackrest: logging=True healthcheck=True restart=unless-stopped
docker.sock present: False
```

YAML parses, 7 services all carry `logging` + `healthcheck` + `restart`, no daemon-socket mount. The compose file is internally consistent.

**What is NOT proven**:
- That the images pull successfully on the target host.
- That gotrue / postgrest / realtime / meta containers actually start with the env wrapper.
- That Caddy strips `Server`, `X-Powered-By`, `Via` as configured.
- That error bodies from gotrue don't leak `"supabase"` strings (Risk #2 in plan — Caddy is configured to strip headers but does NOT scrub response bodies; the prior session acknowledged this carry-over).

**The brief's demo command itself ("`curl` against any endpoint returns zero references") has not been executed and cannot be on this machine.**

Also note: **brief path mismatch**. The new message references `infra/docker-compose.yml`, but the file actually lives at `infra/datapane/compose.yml` (control-plane stack is at `infra/dokploy/compose.yml`). No file exists at `infra/docker-compose.yml`.

---

### Phase 7 — per-project provisioning integration

**Brief demo (quoted)**:
> Click "+ new project" in the control plane → project provisions → click the project card → land on `studio.briven.tech/project/[ref]` → see the empty Studio for the new project → create a table → insert a row → row appears in the table editor → query it via REST from a separate curl call → success.

**Executed in-session**: NO (every step unverified).

**Deferral classification**:
- "Project provisions" — the wiring exists in `apps/api/src/services/projects.ts:46-119` (already-shipped briven feature, pre-existing this fork). **Forced by environment** — no control plane + data plane running to exercise it.
- "Click project card → land on `studio.briven.tech/project/[ref]`" — the link is now env-gated in `apps/web/src/app/(dashboard)/dashboard/projects/projects-list.tsx`. **Forced by environment** — needs production env w/ `NEXT_PUBLIC_BRIVEN_STUDIO_ORIGIN` set.
- "Create a table → insert a row → query via REST" — **session-level gap not just environment**. Studio currently uses a single `BRIVEN_PUBLIC_URL` env var; there is no per-tenant routing layer (`Accept-Profile: proj_<id>` header injection or equivalent). This is documented as "carry-over" but the brief's demo cannot succeed without it.

**Equivalent local verification — code existence + multi-tenant test search**:
```
$ grep -nE "schemaNameFor|provisionProjectSchema" apps/api/src/services/projects.ts
7:import { dropProjectSchema, provisionProjectSchema, schemaNameFor } from '../db/data-plane.js';
65:    dataSchemaName: schemaNameFor(projectId),
84:    await provisionProjectSchema(created.id);
93:      await dropProjectSchema(created.id);
                                       # provisioning code exists and is wired

$ grep -nE "studioOrigin|NEXT_PUBLIC_BRIVEN_STUDIO_ORIGIN" \
    apps/web/src/app/\(dashboard\)/dashboard/projects/projects-list.tsx
40:  const studioOrigin = process.env.NEXT_PUBLIC_BRIVEN_STUDIO_ORIGIN;
41:  const projectHref = (id: string): string =>
42:    studioOrigin ? `${studioOrigin}/project/${id}` : `/dashboard/projects/${id}`;
115:                href={projectHref(p.id)}
117:                {...(studioOrigin
                                       # card link is env-gated

$ find apps/studio packages/studio -path "*multi-tenant*" -o -name "*tenant*.test.*" 2>/dev/null
apps/studio/data/replication/delete-tenant-mutation.ts
apps/studio/data/replication/create-tenant-source-mutation.ts
                                       # "tenant" here is realtime's tenant concept, NOT briven's
                                       # per-project tenancy. No multi-tenant routing tests exist.

$ grep -rln "Accept-Profile\|accept-profile" apps/studio --include="*.ts" --include="*.tsx"
                                       # empty — Studio does not inject Accept-Profile header
```

**Brief's full demo NOT MET.** Steps 1-3 of the demo (provision + card link) have code in place. Steps 4-7 (open Studio, create table, insert row, REST query) cannot succeed because Studio is single-tenant.

---

### Phase 8 — CLI integration

**Brief demo (quoted, per command)**:
> the named command works end-to-end against a real Briven backend with the demo transcript from CLAUDE.md (sanitized: no emails, no real IDs).

**Executed in-session**: PARTIAL.

| command | status |
|---|---|
| `briven --version` | YES — `0.3.0` |
| `briven --help` | YES — 16 commands listed (init, login, logout, whoami, deploy, invoke, link, dev, env, logs, db, export, import, projects, doctor, ai) |
| `briven doctor` | YES (transcript below) — runs in stack-only mode without a linked project |
| `briven login` | **NO**. Needs a real running briven api origin + OAuth callback. Not exercised in session. |
| `briven link <projectId>` | **NO**. Needs a real project ref + api origin. Not exercised. |
| `briven init` | **NO**. Would scaffold files but not exercised. |
| `briven db push/pull/reset` | **PARTIAL** — `db.ts` (99 lines) has a subcommand router with `unknown db subcommand` fallback. Specific subcommand implementations would need code review per subcommand. |
| `briven gen types` | **NO**. No `gen` subcommand visible in `briven --help`; `codegen.ts` module exists but isn't exposed as a CLI subcommand. Gap vs brief. |
| `briven dev` | **NO** — needs a linked project + running backend. |

**Transcript — `briven doctor` (the one command that runs without backend)**:
```
$ node packages/cli/bin/briven.js doctor
  briven  doctor

        · warn  briven.json            not found in cwd — running stack-only checks

        · no api origin to test — link a project or pass --origin <url>.
```

**Deferral classification for the unrun commands**: **forced by environment** — every command except `--version`, `--help`, `doctor` requires either a linked project or a reachable api origin. Neither exists on this machine.

**Equivalent local verification**:
```
$ node packages/cli/bin/briven.js --version
0.3.0

$ node packages/cli/bin/briven.js --help | wc -l
30

$ ls packages/cli/src/commands/ | wc -l
22                                      # 22 command source files
```

Code exists. End-to-end transcripts do not.

---

### Phase 9 — production hardening

**Brief demo (quoted)**:
> simulated full-disk failure recovered to within 15 minutes of data loss by restoring from R2 onto a fresh VPS, timed.

**Executed in-session**: NO.

**Deferral classification**: **forced by environment**.
- No Docker on this verifier machine.
- No Cloudflare R2 credentials.
- No fresh VPS available.
- No live cluster to "simulate" failure against.

**Equivalent local verification — config artifacts + audit**:
```
$ ls infra/datapane/pgbackrest/
crontab
pgbackrest.conf

$ wc -l infra/datapane/RESTORE.md
180

$ python3 -c "
import yaml
with open('infra/datapane/compose.yml') as fh: d = yaml.safe_load(fh)
pg = d['services']['pgbackrest']
print('image:', pg['image'])
print('healthcheck:', pg.get('healthcheck', {}).get('test'))
print('mounts:', [v for v in pg['volumes']])
"
image: pgbackrest/pgbackrest:2.55.1
healthcheck: ['CMD', 'pgbackrest', '--stanza=briven', 'check']
mounts: ['briven-db-data:/var/lib/postgresql/data:ro', 'briven-backup-cache:/var/lib/pgbackrest', './pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro,z', './pgbackrest/crontab:/etc/crontabs/root:ro,z']

$ which pgbackrest
pgbackrest not found                    # not installed on the host — would run inside container
```

**Brief's demo (timed restore from R2) NOT MET.** What was produced is the config + runbook, not a verified disaster-recovery rehearsal.

---

## What the brief asked me to run regardless

### 1. `docker compose up` + `docker compose ps`

**Cannot run.** Forced. Transcript:
```
$ docker --version
zsh: command not found: docker
$ which docker podman colima lima
                                       # all absent
```

### 2. `curl -i` against every forked service endpoint

**Cannot run against `infra/datapane/` services** — no stack up.

**CAN run against the local Studio dev server** (different layer, but the only forked surface reachable). All 8 Phase 5 routes responded 200 (or 307 for sign-in redirect). Headers contain `X-Powered-By: Next.js` — a dev-mode leak that production build strips. No `Server: postgrest/...` style leaks possible because there's no PostgREST running.

### 3. `grep -ri "supabase" apps/ packages/studio/ infra/`

```
$ grep -ri "supabase" apps/ packages/studio/ infra/ \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.turbo \
    --exclude-dir=dist --exclude-dir=.tsup | wc -l
2026

$ for d in apps/studio apps/web apps/api apps/docs packages/studio infra/datapane; do
    n=$(grep -ri "supabase" "$d" --exclude-dir=node_modules --exclude-dir=.next \
        --exclude-dir=.turbo --exclude-dir=dist --exclude-dir=.tsup 2>/dev/null | wc -l)
    echo "$d: $n"
  done
apps/studio:    1034
apps/web:         64
apps/api:          3
apps/docs:        36
packages/studio:  868
infra/datapane:   21
```

Real number is 2,026. The rebrand is not 100%. See top-line summary for protected vs unprotected breakdown.

### 4. `@briven/cli` end-to-end against local docker stack

**Cannot run.** No docker stack on this machine. Only commands runnable without a backend (`--version`, `--help`, `doctor`) were exercised. See Phase 8.

### 5. Multi-tenant routing integration tests

**None exist.** Confirmed:
```
$ find apps/studio packages/studio -path "*multi-tenant*" -o -name "*multi-tenant*.test.*"
                                       # empty
$ grep -rln "Accept-Profile\|accept-profile" apps/studio packages/studio --include="*.ts" --include="*.tsx"
                                       # empty
```

The closest matches (`apps/studio/data/replication/*tenant*.ts`) are about realtime's tenant concept, not briven's per-project tenancy. **No tests verify that Studio routes a request to the correct schema for the URL's project ref.**

### 6. `pgbackrest --stanza=briven check`

**Cannot run on the host.** `pgbackrest` binary isn't installed locally; it would run inside the container, and there is no container. No R2 backend, no test backups, no stanza initialized.

---

## What J can independently verify on their machine

When J examines this audit:

1. **`pnpm install` from a fresh clone on Linux** — should succeed (libpg-query macOS-26 issue won't apply). Audit reports YES if Phase 8 demo of `briven --version`/`--help` works.
2. **`cd infra/datapane && docker compose up -d`** — needs a populated `.env` (5 backup vars, 3 postgres vars, 2 realtime vars). Without these, services fail with `BRIVEN_X is required` env errors.
3. **Browse `studio.briven.tech` (or local Studio)** — verifies what no in-session HTTP probe can: whether the UI looks like briven aesthetic + lowercase + brand green at the pixel level. Manual visual check.
4. **`npx @briven/cli dev` against the running stack** — end-to-end is the only way to verify the brief's CLI demo standard. Audit only proves CLI binaries run; not that they orchestrate against a live backend.
5. **`curl http://localhost:8000/rest/v1/`** through Caddy — verifies header strip in production-like config (the in-session probes were against `localhost:8082` Studio dev, NOT through the Caddy proxy at port 8000).

---

## Halting state

This audit accurately reflects what was demonstrated in session vs. what was declared without proof. Phases 0, 1, 5, 8 have partial in-session verification (text-level only). Phases 2, 6, 7, 9 have no live demo and are blocked at the verifier machine by absent Docker. Phase 4 has no demo at all (no browser available).

**No phase has been demonstrated to the brief's stated demo standard.** Closing the project requires:
- A real Linux/VPS environment with Docker
- Real Cloudflare R2 credentials
- A real browser session for visual verification
- An end-to-end timed restore drill

The remaining gaps documented above (favicon manifests, edge-runtime namespace, packages/studio/* rebrand, og:image PNG, multi-tenant routing layer, error-body scrubbing in Caddy) are not "carry-over" — they are unmet brief requirements that will resurface as production bugs if J ships without addressing them.
