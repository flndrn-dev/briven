# Briven

**The version-controlled backend you own.**

[briven.tech](https://briven.tech) is a managed backend platform for app builders: databases you can branch like Git, authentication, file storage, serverless functions, and realtime — without running your own servers if you do not want to.

| Surface | What it is |
|---------|------------|
| **[briven.tech](https://briven.tech)** | Hosted product (dashboard, projects, billing) |
| **[docs.briven.tech](https://docs.briven.tech)** | Documentation |
| **[api.briven.tech](https://api.briven.tech)** | Control plane API |
| **briven-core** | Open-source engine (self-hostable, AGPL-3.0) |
| **`npx @briven/cli`** | Developer CLI (MIT) |

---

## What you get (product map)

### 1. Projects & databases (Doltgres)

Every **project** on Briven is an isolated app environment.

- **SQL database** with a normal Postgres wire protocol (tools like `psql`, Prisma, Drizzle, and many ORMs work).
- Under the hood production uses **[Doltgres](https://www.doltgres.com)** — SQL **plus** Git-style history: branches, commits, diffs, and time-travel.
- Stock Postgres is **not** the product database engine for Briven.tech.
- Control plane metadata and each project’s data plane live on Doltgres (database-per-project model).

**In the dashboard:** open a project → database / studio to browse tables and run SQL.

**For apps:** use project connection settings and API keys (`brk_…`) for server-side data access. Never put admin secrets in a public frontend.

---

### 2. Briven Auth

**Briven Auth** (product name: **briven-engine**) signs end-users into *your* applications — not only the Briven.tech operator login.

| Capability | Description |
|------------|-------------|
| Email + password | Classic sign-up / sign-in |
| Email OTP / magic link | Passwordless email flows |
| SMS OTP | Optional; Twilio secrets per project |
| Social login | Google, GitHub, Konnos, and more when secrets are configured |
| Passkeys & MFA (TOTP) | Modern second factor |
| Enterprise SSO | SAML / OIDC *into* your app (company IdP) |
| Sessions & roles | List / revoke sessions; roles & permissions |
| Security diary | Audit trail of sign-ins and config changes |
| M2M | Machine clients: client id + secret → short-lived tokens |
| OIDC IdP | Briven as a login office for *other* apps (authorize, token, userinfo, …) |

**Dashboard:** **Auth** → pick a project → Overview, Users, Sessions, Security, Keys, **IdP**, Providers, Branding, Enterprise.

**For apps:** prefer a first-party proxy (e.g. `/api/auth/*` on your domain → Briven FDI) so session cookies stay on your site.

**Docs:** [docs.briven.tech/auth](https://docs.briven.tech/auth)

Auth SDK keys look like `pk_briven_auth_…` — different from data-plane `brk_…` keys and storage keys.

---

### 3. File storage (S3 buckets)

Briven gives each project **private object storage** (S3-compatible, MinIO on the managed stack).

| Item | Detail |
|------|--------|
| Endpoint | `https://s3.briven.tech` |
| Bucket | One primary bucket per project (e.g. `proj-…`) |
| Keys | Scoped access keys from the dashboard (secret shown once) |
| Public media | `https://media.briven.tech/media/<projectId>/<fileId>` when configured |
| Soft delete | Restore from dashboard / tools where enabled |

**This is not your SQL database.** Files live in S3; rows live in Doltgres.  
**This is not platform disaster-recovery backups** (those are a separate ops concern).

**Dashboard:** project → **Storage** → create key → copy endpoint, bucket, access key, secret into **server** env only.

**CLI:** `briven setup` / `briven connect` can mint storage credentials into `.env.local` when possible.

**Docs:** [docs.briven.tech/storage](https://docs.briven.tech/storage)

---

### 4. Functions, realtime, and the rest

| Area | Role |
|------|------|
| **Functions** | Serverless-style compute for your project (Deno isolate runtime on the managed product) |
| **Realtime** | Reactive / websocket paths for live updates |
| **Schedules** | Timed jobs |
| **Studio** | Embedded data browser in the product |
| **MCP** | Agent-facing tools bound to a single project key |

---

## Quick start (CLI)

```bash
mkdir my-app && cd my-app
npx @briven/cli setup --name my-app   # new project + wire this folder
# or, existing project:
# npx @briven/cli connect p_…
briven deploy                         # or: briven dev
```

- **New project:** `briven setup` / `briven setup --name my-app`
- **Existing project:** `briven connect p_…` (do not use `setup --project`)
- Docs: [connect](https://docs.briven.tech/connect) · [quickstart](https://docs.briven.tech/quickstart)

---

## Keys (do not mix them)

| Key style | Used for |
|-----------|----------|
| `brk_…` | Project data plane / API (server) |
| `pk_briven_auth_…` | Auth SDK / app auth config |
| `brvn…` / storage access keys | One project’s S3 bucket |
| M2M / OIDC client secrets | Machine tokens / “Sign in with Briven” apps |

Never commit secrets. Rotate anything that has appeared in chat or a public log.

---

## Monorepo layout

```
apps/
  web/        briven.tech — marketing + dashboard (Next.js)
  docs/       docs.briven.tech
  api/        api.briven.tech — control plane (Hono on Bun)
  runtime/    function runtime host
  realtime/   websocket service
  studio/     embedded data browser

packages/
  cli/             @briven/cli
  client-react/    @briven/react
  client-vanilla/  @briven/client
  schema/          schema DSL + migrations
  shared/          shared types and utilities

infra/
  dokploy/    compose templates for deploy / self-host
```

---

## Local development

Requires **Node 20 LTS**, **pnpm 9+**, and **Bun** for `apps/api`.

```bash
pnpm install
pnpm dev
```

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

---

## Tech stack (summary)

- TypeScript (strict)
- Next.js + Tailwind for web / docs / dashboard
- Hono on Bun for the control plane
- **Doltgres** for SQL + version history (Postgres wire)
- MinIO for S3-compatible project storage
- Redis where queues / rate limits need it
- Observability: Grafana, Loki, Prometheus (ops stack)

---

## Brand & licence

- Product UI: dark theme; accent `#00e87a` (auth surfaces may use the yellow Auth accent).
- **briven-core** (engine): **AGPL-3.0**
- **@briven/cli** and **@briven/client-\***: **MIT**

---

## Links

| | |
|--|--|
| Product | [briven.tech](https://briven.tech) |
| Docs | [docs.briven.tech](https://docs.briven.tech) |
| Source (Konnos) | [code.konnos.org/flndrn/briven](https://code.konnos.org/flndrn/briven) |

---

## Maintainers: git remotes

- **Konnos:** `https://code.konnos.org/flndrn/briven.git`
- Optional GitHub mirror may exist; prefer the remotes configured on this machine.

Pushing `main` does **not** by itself redeploy production unless a separate deploy workflow is run. Deploy via your Dokploy / ops path after review.
