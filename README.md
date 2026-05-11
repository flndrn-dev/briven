# briven

> the postgres backend you actually own

briven is an open-core, reactive backend platform for typescript developers. convex-style ergonomics (code-first schema, cli deploys, reactive queries, built-in auth/storage/scheduling) on top of standard postgres, multi-region worldwide, fully self-hostable.

three surfaces:

- [**briven.tech**](https://briven.tech) — managed hosted service
- **briven-core** — the open-source engine, self-hostable under agpl-3.0
- **[`npx briven`](https://www.npmjs.com/package/@briven/cli)** — the developer cli, mit-licensed

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
- postgres 17 + pgvector + pg_cron + pgmq
- better auth (google + github + konnos + magic link), polar.sh, mittera.eu, minio, redis
- grafana + loki + prometheus + postgres-exporter for observability

## brand

lowercase everywhere. dark-theme only. one primary accent: `#00e87a`. assets in `/assets/`.

## licences

- `briven-core` (engine): **agpl-3.0**
- `@briven/cli` and every `@briven/client-*`: **mit**

## links

- source: [code.konnos.org/flndrn/briven](https://code.konnos.org/flndrn/briven)
- managed product: [briven.tech](https://briven.tech)
- docs: [docs.briven.tech](https://docs.briven.tech)
