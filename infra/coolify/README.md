# self-host briven on coolify

drop-in template for [coolify 4.x](https://coolify.io). same compose as `infra/dokploy/compose.yml`, minus the traefik labels — coolify owns routing through its own UI.

briven publishes **prebuilt multi-arch images** on every tagged release at `ghcr.io/flndrn/briven-{api,runtime,realtime,web,docs}` (amd64 + arm64, free anonymous pull). swap the `build:` blocks in `compose.yml` for `image: ghcr.io/flndrn/briven-<svc>:latest` for ~30s deploys, or pin to a specific version tag (e.g. `:0.3.1`) for reproducibility. building from source is also supported — useful when you've forked.

## install

1. **create a new resource** in your coolify project: **Docker Compose**, point its git source at `https://code.konnos.org/flndrn/briven.git` (branch `main`), compose path `infra/coolify/compose.yml`. coolify clones the repo and runs `docker compose build` + `up -d`.
2. **set environment variables** under the resource's *Environment Variables* tab. The minimum:

   | name                            | value                                      |
   | ------------------------------- | ------------------------------------------ |
   | `BRIVEN_DOMAIN`                 | the domain you control (e.g. `briven.example.com`) |
   | `BRIVEN_POSTGRES_PASSWORD`      | strong random — used by every service      |
   | `BRIVEN_BETTER_AUTH_SECRET`     | `openssl rand -hex 32`                     |
   | `BRIVEN_AUDIT_IP_PEPPER`        | `openssl rand -hex 32`                     |
   | `BRIVEN_ENCRYPTION_KEY`         | `openssl rand -hex 32`                     |
   | `BRIVEN_RUNTIME_SHARED_SECRET`  | `openssl rand -hex 32`                     |
   | `BRIVEN_OPEN_SIGNUPS`           | `false` (invite-only) or `true` (public)   |

   optional:

   | name                          | what it enables                            |
   | ----------------------------- | ------------------------------------------ |
   | `BRIVEN_MITTERA_API_URL`      | `https://api.mittera.eu` (or your install) |
   | `BRIVEN_MITTERA_API_KEY`      | bearer token for outbound /api/v1/emails   |
   | `BRIVEN_MITTERA_WEBHOOK_SECRET` | HMAC secret for inbound webhook verify   |
   | `BRIVEN_GITHUB_CLIENT_ID`     | github oauth signin                        |
   | `BRIVEN_GITHUB_CLIENT_SECRET` | github oauth signin                        |

3. **assign domains** in the coolify *Domains* tab, one per public-facing service:

   - `web` → `${BRIVEN_DOMAIN}`
   - `api` → `api.${BRIVEN_DOMAIN}`
   - `realtime` → `realtime.${BRIVEN_DOMAIN}`
   - `docs` → `docs.${BRIVEN_DOMAIN}`

   `postgres`, `redis`, `runtime` stay internal — leave their domains blank.

4. **deploy**. coolify wires letsencrypt + a per-service reverse proxy automatically.

## post-boot

same as the dokploy template — sign in via magic link, promote yourself to platform-admin via psql, then create your first project from the dashboard. see `../dokploy/README.md` for the full walkthrough.

## differences vs. dokploy

- **routing**: coolify's per-service Domains UI replaces the `traefik.*` labels.
- **persistent volumes**: coolify auto-manages volume names with project-scoped prefixes; the names declared here (`postgres_data`, etc.) become `briven_postgres_data` or similar in coolify's storage tab.
- **upgrades**: click *Redeploy* — coolify re-clones `main` and rebuilds the images from source. there's no `docker compose pull` step because nothing is hosted in a registry.

## upgrade path

dokploy → coolify migrations work as long as the postgres + minio + runtime_bundles volumes are preserved. shut down the dokploy stack, snapshot the volumes, point coolify at the same data directories. control plane comes back stateful.
