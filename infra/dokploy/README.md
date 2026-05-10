# self-host briven on dokploy

single-machine compose template for running briven-core on your own infrastructure. all four services + postgres + redis + minio in one stack, fronted by traefik. tested on dokploy 0.20+, coolify 4.x, and plain `docker compose` on ubuntu 24.04.

briven is **built from source** off `code.konnos.org/flndrn/briven`. there are no prebuilt images — `docker compose build` produces the per-service images locally on the deploy host. that keeps the stack self-contained and avoids relying on a hosted registry.

## prereqs

- a vps with docker + docker compose (4 vcpu / 8 gb ram comfortably runs a dozen briven projects). cpu/ram during the first `docker compose build` peaks around 4 gb — size accordingly.
- a domain pointed at the vps with a wildcard A record covering `*.<your-domain>`
- traefik already running on the host with the `web` and `websecure` entrypoints + a `letsencrypt` cert resolver. dokploy gives you all of this out of the box.

if you're new to traefik, the dokploy quick-start handles it; for raw `docker compose` deploys see [traefik's getting started](https://doc.traefik.io/traefik/getting-started/quick-start/).

## five-minute install

```bash
# 1. clone the repo
git clone https://code.konnos.org/flndrn/briven.git
cd briven/infra/dokploy

# 2. copy + fill the env file
cp .env.example .env
# edit .env and fill the secrets + BRIVEN_DOMAIN + BRIVEN_POSTGRES_PASSWORD
# generate each secret with: openssl rand -hex 32

# 3. build + start the stack (first build takes ~5-8 min)
docker compose build
docker compose up -d

# 4. watch the boot logs (api should reach "api_boot" within ~10s)
docker compose logs -f api
```

on dokploy itself the equivalent flow is:

1. **new project → docker compose**, point the git source at `https://code.konnos.org/flndrn/briven.git` (branch `main`), compose path `infra/dokploy/compose.yml`.
2. paste the env vars under *Environment Variables*.
3. dokploy runs `docker compose build` + `up -d` for you on every deploy.

## post-boot

1. open `https://<your-domain>` and sign in via magic link. without `BRIVEN_MITTERA_API_URL` and `BRIVEN_MITTERA_SIGNING_SECRET` set, the magic link prints to the api container's stdout — `docker compose logs api | grep magic_link` to find it. Once mittera.eu is wired, also register `https://<your-domain>/api/mittera-webhook` on the mittera side so delivery and bounce events flow back.
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

build-from-source means upgrades pull and rebuild rather than pull a tag:

```bash
git pull origin main
docker compose build
docker compose up -d
```

on dokploy, *Redeploy* runs the same sequence after re-cloning. all services share the same env, so they stay in lockstep across the upgrade. take a backup before any upgrade — see [`infra/backups/`](../backups/).

## licence

the engine images (`briven-api`, `briven-runtime`, `briven-realtime`, `briven-web`, `briven-docs`) are AGPL-3.0. self-host freely. if you offer a SaaS version of briven to third parties, your modifications must be public. the cli (`@briven/cli`) and the client SDKs are MIT.

contact the team for a commercial-licence carve-out if AGPL is incompatible with your use case.

## related

- [`infra/observability/`](../observability/) — grafana + loki + prometheus + promtail
- [`infra/backups/`](../backups/) — nightly pg_dump cron + monthly restore drill
- [`infra/traefik/`](../traefik/) — wildcard tls templates if your traefik isn't already managing certs

## not bundled here yet

- **k8s helm charts** — year-two scope. swap when you hit ~100 projects per host.
