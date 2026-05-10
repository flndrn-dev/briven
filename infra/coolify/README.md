# self-host briven on coolify

drop-in template for [coolify 4.x](https://coolify.io). same compose as `infra/dokploy/compose.yml`, minus the traefik labels — coolify owns routing through its own UI.

## install

1. **create a new resource** in your coolify project: **Docker Compose**, paste the contents of `compose.yml` (or point at this directory if you've cloned the repo onto your coolify host).
2. **set environment variables** under the resource's *Environment Variables* tab. The minimum:

   | name                            | value                                      |
   | ------------------------------- | ------------------------------------------ |
   | `BRIVEN_DOMAIN`                 | the domain you control (e.g. `briven.example.com`) |
   | `BRIVEN_VERSION`                | `latest` or a pinned tag like `v0.5.0`     |
   | `BRIVEN_POSTGRES_PASSWORD`      | strong random — used by every service      |
   | `BRIVEN_BETTER_AUTH_SECRET`     | `openssl rand -hex 32`                     |
   | `BRIVEN_AUDIT_IP_PEPPER`        | `openssl rand -hex 32`                     |
   | `BRIVEN_ENCRYPTION_KEY`         | `openssl rand -hex 32`                     |
   | `BRIVEN_RUNTIME_SHARED_SECRET`  | `openssl rand -hex 32`                     |
   | `BRIVEN_OPEN_SIGNUPS`           | `false` (invite-only) or `true` (public)   |

   optional:

   | name                          | what it enables                            |
   | ----------------------------- | ------------------------------------------ |
   | `BRIVEN_RESEND_API_KEY`       | magic-link emails (otherwise stdout)       |
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
- **upgrades**: change `BRIVEN_VERSION` and click *Deploy* — coolify pulls the new image without an explicit `docker compose pull`.

## upgrade path

dokploy → coolify migrations work as long as the postgres + minio + runtime_bundles volumes are preserved. shut down the dokploy stack, snapshot the volumes, point coolify at the same data directories. control plane comes back stateful.
