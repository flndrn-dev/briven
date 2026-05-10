# self-host briven on dokploy

single-machine compose template for running briven-core on your own infrastructure. all four services + postgres + redis + minio in one stack, fronted by traefik. tested on dokploy 0.20+, coolify 4.x, and plain `docker compose` on ubuntu 24.04.

## prereqs

- a vps with docker + docker compose (4 vcpu / 8 gb ram comfortably runs a dozen briven projects)
- a domain pointed at the vps with a wildcard A record covering `*.<your-domain>`
- traefik already running on the host with the `web` and `websecure` entrypoints + a `letsencrypt` cert resolver. dokploy gives you all of this out of the box.

if you're new to traefik, the dokploy quick-start handles it; for raw `docker compose` deploys see [traefik's getting started](https://doc.traefik.io/traefik/getting-started/quick-start/).

## five-minute install

```bash
# 1. clone the repo (or download just this directory)
git clone https://github.com/flndrn-dev/briven.git
cd briven/infra/dokploy

# 2. copy + fill the env file
cp .env.example .env
# edit .env and fill the four secrets + BRIVEN_DOMAIN + BRIVEN_POSTGRES_PASSWORD
# generate each secret with: openssl rand -hex 32

# 3. start the stack
docker compose up -d

# 4. watch the boot logs (api should reach "api_boot" within ~10s)
docker compose logs -f api
```

## post-boot

1. open `https://<your-domain>` and sign in via magic link. without `BRIVEN_RESEND_API_KEY` set, the magic link prints to the api container's stdout — `docker compose logs api | grep magic_link` to find it.
2. give yourself platform-admin so the `/admin` tab unlocks:
   ```bash
   docker compose exec postgres psql -U postgres -d briven_control \
     -c "UPDATE users SET is_admin = true WHERE email = '<your-email>'"
   ```
3. create your first project from the dashboard. the data-plane schema (`proj_<projectId>`) provisions automatically.
4. install the cli in any project repo: `pnpm add -D @briven/cli` and follow the [quickstart](https://docs.briven.cloud/quickstart).

## what each container does

- **postgres** — both control plane (`briven_control`) and data plane (`briven_data`). `postgres-init/01-create-data-plane.sql` runs once at first boot to create the second database + load `pgvector` and `pg_trgm` in both.
- **redis** — sessions, rate limits, log fan-out queue.
- **minio** — S3-compatible storage. defaults to one bucket per project.
- **api** — hono on bun. control plane: accounts, projects, billing, deploy intake, admin.
- **runtime** — deno isolates host. one isolate per project, warm-cached.
- **realtime** — bun + websocket. holds a postgres LISTEN connection, fans out NOTIFYs to subscribed clients.
- **web** — next.js 16 dashboard.
- **docs** — next.js 16 docs site (the one you're reading; ships locally so docs work offline).

## scaling out

the single-machine layout is fine to ~25 projects. past that, the standard split is:

- **control-plane host** — `api` + `web` + `docs` + `redis`
- **data-plane host** — `postgres` + `runtime` + `realtime` + `minio`
- **observability host** — drop `infra/observability/compose.yml` here

add a second `briven` overlay network spanning the two hosts (docker swarm or tailscale) so the control plane can reach `briven-runtime:3003` + `briven-postgres:5432` over the same names this compose uses.

## upgrades

pin a release tag in `.env`:

```env
BRIVEN_VERSION=v0.5.0
```

then `docker compose pull && docker compose up -d`. all four services accept the same env, so they stay in lockstep across the upgrade. backups before any upgrade — see [`infra/backups/`](../backups/).

## licence

the engine images (`briven-api`, `briven-runtime`, `briven-realtime`, `briven-web`, `briven-docs`) are AGPL-3.0. self-host freely. if you offer a SaaS version of briven to third parties, your modifications must be public. the cli (`@briven/cli`) and the client SDKs are MIT.

contact the team for a commercial-licence carve-out if AGPL is incompatible with your use case.

## related

- [`infra/observability/`](../observability/) — grafana + loki + prometheus + promtail
- [`infra/backups/`](../backups/) — nightly pg_dump cron + monthly restore drill
- [`infra/traefik/`](../traefik/) — wildcard tls templates if your traefik isn't already managing certs

## not bundled here yet

- **coolify-specific service definitions** — coolify reads the same compose with one tweak: drop the `traefik.*` labels in favour of coolify's own routing UI. the compose works on coolify as-is; the `coolify.json` service descriptor lands with the public release.
- **k8s helm charts** — year-two scope. swap when you hit ~100 projects per host.
