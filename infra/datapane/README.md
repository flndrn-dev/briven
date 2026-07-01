# `infra/datapane/`

briven per-project Postgres backend stack — Phase 6 of `BACKEND_FORK_BRIEF.md`.

This is the **data plane**: the Postgres + REST + Auth + Realtime + meta services that the Studio (`apps/studio`) and end-user projects talk to. It is **separate** from the **control plane** at `infra/dokploy/` (the briven.tech dashboard, billing, projects table).

## Services

| service    | image                            | exposed via | purpose                              |
| ---------- | -------------------------------- | ----------- | ------------------------------------ |
| `caddy`    | `caddy:2.10-alpine`              | 80 / 443    | reverse proxy; strips upstream headers |
| `db`       | `supabase/postgres:15.8.1.085`   | 5432        | Postgres data plane                  |
| `auth`     | `supabase/gotrue:v2.186.0`       | `/auth/v1`  | JWT auth, sign-up/login              |
| `rest`     | `postgrest/postgrest:v14.8`      | `/rest/v1`  | REST API auto-gen from schema        |
| `realtime` | `supabase/realtime:v2.76.5`      | `/realtime` | WebSocket subscriptions              |
| `meta`     | `supabase/postgres-meta:v0.96.3` | `/pg`       | schema introspection (Studio dep)    |

## Services NOT in this stack (and why)

| service    | reason                                                        |
| ---------- | ------------------------------------------------------------- |
| `studio`   | deployed separately as a Next.js app (`apps/studio`)          |
| `kong`     | replaced with caddy — see `BACKEND_FORK_PLAN.md` §1            |
| `storage`  | deferred to Phase 9 per brief §5                              |
| `imgproxy` | couples to storage; deferred to Phase 9                       |
| `functions`| briven has separate Deno isolate plan; deferred               |
| `analytics`| Logflare not used; briven logs to Loki via filesystem tail    |
| `vector`   | bind-mounts `/var/run/docker.sock` — hard violation of `docs/DOCKER.md` rule 6. Never re-add |
| `supavisor`| connection pooler; deferred to Phase 9 (matters only at scale)|

## Local run

```bash
cd infra/datapane
cp .env.example .env
# edit .env, fill in real secrets
docker compose up -d
docker compose ps
```

Health-check the stack:

```bash
# REST should respond with PostgREST's OpenAPI doc — but headers should NOT name PostgREST.
curl -sI http://localhost:8000/rest/v1/
# Expected:
#   Server: briven
#   (no X-Powered-By, no Server: postgrest/...)

# Auth health endpoint.
curl -sI http://localhost:8000/auth/v1/health

# Meta schema introspection.
curl -s http://localhost:8000/pg/version
```

## Demo (per brief §5 Phase 6)

> `docker-compose up from infra/` brings up the full Briven backend stack. `curl` against any endpoint returns headers and error messages that contain zero references to Supabase, GoTrue, PostgREST by name, or any other underlying component identifier.

After `docker compose up -d`:

```bash
# Pass: server header is "briven", upstream identifiers are stripped.
curl -sI http://localhost:8000/rest/v1/ | grep -iE "server|powered|via"

# Fail (sanity): would return non-empty if upstream headers leaked.
curl -sI http://localhost:8000/rest/v1/ | grep -iE "postgrest|gotrue|supabase|kong|caddy"
```

## Companion files

| file                              | purpose                                          |
| --------------------------------- | ------------------------------------------------ |
| `compose.yml`                     | the live stack — what `docker compose up` runs   |
| `compose.upstream.yml`            | preserved rebrand-swept upstream supabase compose, for comparison. NOT used at runtime. |
| `compose.caddy.yml`               | upstream's caddy variant — preserved for reference |
| `.env.example`                    | env template                                     |
| `volumes/proxy/caddy/Caddyfile`   | reverse-proxy config; strips identifying headers |
| `volumes/db/*.sql`                | init scripts (roles, jwt, realtime, webhooks)    |
| `CONFIG.upstream.md`              | upstream supabase docs for reference            |
| `versions.upstream.md`            | upstream image version pins for reference       |

## Hard rules (cross-ref `infra/CLAUDE.md`)

Every service has `logging: *briven-logging` (10MB × 3 files). No service mounts `/var/run/docker.sock`. No service polls the Docker daemon. Re-run the log-cap audit when adding services:

```bash
python3 -c "
import yaml
with open('infra/datapane/compose.yml') as fh: d=yaml.safe_load(fh)
missing=[s for s,c in d['services'].items() if c.get('restart')=='unless-stopped' and 'logging' not in c]
print('missing log cap:', missing or 'none')
"
```
