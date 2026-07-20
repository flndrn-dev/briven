# briven

> the version-controlled backend you own

## 🔴 Doltgres-first (product DNA)

**Briven.tech is built on [Doltgres](https://www.doltgres.com)** — Postgres-wire SQL with git-style branch, commit, and time-travel.  
Control plane and every project database run on **Doltgres**. Stock Postgres is not the product engine.  
See **`DOLTGRES-FIRST.md`** (hard rule for all contributors and agents).

briven is an open-core, reactive backend platform for typescript developers. convex-style ergonomics (code-first schema, cli deploys, reactive queries, built-in auth/storage/scheduling) on a git-native sql database — branches, time-travel, commit history. worldwide multi-region. fully self-hostable.

three surfaces:

- [**briven.tech**](https://briven.tech) — managed hosted service
- **briven-core** — the open-source engine, self-hostable under agpl-3.0
- **[`npx briven`](https://www.npmjs.com/package/@briven/cli)** — the developer cli, mit-licensed

### get started (cli)

```bash
mkdir my-app && cd my-app
npx @briven/cli setup --name my-app   # sign in + create project + wire folder
briven deploy                         # or: briven dev
```

Interactive: `briven setup` (pick new vs existing). Attach existing: `briven setup --project p_…`.  
Docs: [connect](https://docs.briven.tech/connect) · [quickstart](https://docs.briven.tech/quickstart)

### remotes (maintainers)

- **GitHub** (auto-deploy on `main`): `https://github.com/flndrn-dev/briven.git`
- **Konnos** (mirror): `https://code.konnos.org/flndrn/briven.git`

One push to both (this machine is already configured; re-apply anywhere with):

```bash
./scripts/git-push-both.sh setup   # once per clone
git push origin main               # updates GitHub + Konnos only (no auto-deploy)
# or: ./scripts/git-push-both.sh main
```

**Auto-deploy is OFF.** Pushing to `main` does **not** redeploy production.
To deploy: GitHub → Actions → **Deploy to Dokploy** → **Run workflow** (manual only).

## status

phase 1 closing — runtime + realtime + studio + dashboard + cli all live on briven.tech. observability stack + nightly backups + automated deploys via konnos all running. private until the phase 3 dogfood window clears (oct 2026).

## monorepo layout

```
apps/
  web/        briven.tech — marketing + dashboard (next.js 16)
  docs/       docs.briven.tech — documentation (next.js 16 + fumadocs)
  api/        api.briven.tech — control plane (hono on bun)
  runtime/    function runtime host (deno + node bridge)
  realtime/   websocket service for reactive queries
  studio/     embedded data browser

packages/
  cli/             @briven/cli
  client-react/    @briven/react
  client-vanilla/  @briven/client
  client-svelte/   @briven/svelte
  client-vue/      @briven/vue
  schema/          schema dsl + migration generator
  shared/          shared types, zod schemas, utilities
  ui/              shared shadcn/ui components
  config/          shared ts / eslint / prettier / tailwind configs

infra/
  dokploy/    dokploy compose templates for self-host
  k8s/        helm charts (year two)
```

## dev

requires **node 20 lts**, **pnpm 9+**, and **bun** for `apps/api`.

```bash
pnpm install
pnpm dev
```

scripts:

```bash
pnpm lint         # eslint across the workspace
pnpm typecheck    # tsc --noEmit across the workspace
pnpm test         # unit tests
pnpm test:e2e     # playwright e2e
pnpm format       # prettier write
pnpm build        # turbo build all
```

## tech stack

see the internal build docs for the authoritative spec. headlines:

- typescript everywhere, strict mode
- next.js 16 + tailwind v4 + shadcn/ui for every ui surface
- hono on bun for the control plane
- deno isolates for the customer function runtime
- git-native sql database (branches, commits, time-travel, diffs)
- better auth (google + github + konnos + magic link), polar.sh, mittera.eu, minio, redis
- grafana + loki + prometheus + postgres_exporter for observability (doltgres is postgres-wire)

## brand

lowercase everywhere. dark-theme only. one primary accent: `#00e87a`. assets in `/assets/`.

## licences

- `briven-core` (engine): **agpl-3.0**
- `@briven/cli` and every `@briven/client-*`: **mit**

## links

- source: [code.konnos.org/flndrn/briven](https://code.konnos.org/flndrn/briven)
- managed product: [briven.tech](https://briven.tech)
- docs: [docs.briven.tech](https://docs.briven.tech)
