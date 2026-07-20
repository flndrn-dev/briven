# Briven France — safe deploy (O.1)

## Cadence (flndrn hard rule)

1. Finish a **large chunk** of work first (many related changes, local tests).
2. **One** deploy for that whole chunk — never after every small edit.
3. **Then** run live testing.

`git push` with `autoDeploy: false` does **not** rebuild France. Deploy only when the batch is ready (or flndrn says “deploy”).

## Why this exists

Dokploy’s full **Deploy** button runs roughly:

```bash
docker compose -p briven-brivenfrance-uilsk6 \
  -f infra/dokploy/compose.dokploy.yml \
  up -d --build --remove-orphans
```

That rebuilds **every** service (api, web, runtime, docs, realtime, …) even when only one app changed. Stacked or mid-rebuild deploys cause:

- containers stuck in `Created` / `Dead`
- `Address already in use` network races
- public `api.briven.tech` returning 404 until repaired

**Rule:** keep **autoDeploy = false** in Dokploy for compose `briven-france`. Ship code with **service-scoped** rebuilds unless you intentionally need a full panel green.

## Everyday code change (preferred)

On France (`root@187.124.64.116`):

```bash
cd /etc/dokploy/compose/briven-brivenfrance-uilsk6/code
git fetch origin main && git checkout main && git pull origin main

# Only what you changed — examples:
docker compose -p briven-brivenfrance-uilsk6 -f infra/dokploy/compose.dokploy.yml build api
docker compose -p briven-brivenfrance-uilsk6 -f infra/dokploy/compose.dokploy.yml up -d --force-recreate --no-deps api

# or api + web together:
# build api web && up -d --force-recreate --no-deps api web
```

Verify:

```bash
curl -sS https://api.briven.tech/ready
curl -sS https://api.briven.tech/info   # buildSha should match what you shipped
```

## When to use full Dokploy Deploy

1. **Failed red panel** after a race — fix stuck containers first, then **one** `compose.deploy` (see skill gotcha #13).
2. **Compose / env / multi-service** change that truly needs all services rebuilt.

Never stack two full deploys. Never leave autoDeploy on.

## Repair stuck mid-deploy

```bash
# Remove Dead / Created api/realtime (and hash-prefixed orphans)
docker ps -a --filter name=briven-brivenfrance-uilsk6 --format '{{.Names}} {{.Status}}'

cd /etc/dokploy/compose/briven-brivenfrance-uilsk6/code
docker compose -p briven-brivenfrance-uilsk6 -f infra/dokploy/compose.dokploy.yml \
  up -d --no-deps --no-build api web runtime docs realtime
```

Then health-check. Optionally one Dokploy deploy for a green panel row.

## Dokploy settings (expected)

| Setting | Value |
|--------|--------|
| Compose | briven-france / `briven-brivenfrance-uilsk6` |
| autoDeploy | **false** |
| Compose file | `infra/dokploy/compose.dokploy.yml` |
| Branch | main |

Toggle via session API: `POST /api/trpc/compose.update` with `{ composeId, autoDeploy: false }`.
