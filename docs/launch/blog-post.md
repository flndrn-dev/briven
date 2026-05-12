# Blog post draft — "briven: an open-core reactive postgres backend"

**Status:** draft. Tone-check before publishing.
**Target publish:** Phase 4 public-beta launch (Q1 2027 per BUILD_PLAN.md).
**Channel:** `briven.tech/blog/launch` + cross-post to dev.to.

---

## Suggested headline options

1. **"briven: postgres + reactive queries + typescript, self-hostable"** — descriptive, low-energy
2. **"shipping briven — what convex on postgres looks like"** — implies a comparison, anchors to a known reference
3. **"we built a typescript backend that you can actually own"** — opinionated, positions ownership angle
4. **"briven is open-core, postgres-native, and reactive by default"** — feature-led

Pick by audience. (1) and (4) for HN; (2) for X; (3) for substack-flavoured channels.

---

## Draft body

> *all lowercase except proper nouns + product names, per BRAND.md. no exclamation points. no marketing voice.*

---

I'm shipping briven today.

briven is an open-core reactive backend for typescript apps. it's postgres underneath — yours, not abstracted — with a typed schema dsl, function wrappers that handle transactions and validation, and a websocket layer that makes any query reactive without changing the function body. self-host the engine under AGPL-3.0, or run a project on briven.tech and skip the ops.

I built briven because I kept running into the same trade-off on every new project. either:

- pick a managed reactive backend (convex, supabase realtime, firebase). great dx, locked in. your data is in their store, in their region, behind their api, billed per their meter. moving off is a migration project.
- pick postgres + write the reactivity yourself. you own everything. and you spend three weekends writing a websocket bridge, a notify-trigger generator, an invalidation system, and the typescript types to glue it together. by week four you wish you'd picked convex.

briven is the third option. postgres is the storage. you own it. the reactivity is in the platform — auto-generated triggers, a websocket service that listens, a typescript client that re-runs your `useQuery` when a table you touched changes. the function wrappers are familiar if you've used convex: `query()` for reads, `mutation()` for writes, `action()` for long-running side effects. but the underlying database is plain postgres. you can `psql` into it. you can `pg_dump` it. you can leave.

## what's in the box

```ts
// briven/schema.ts
import { boolean, schema, table, text, timestamp } from '@briven/cli/schema';

export default schema({
  posts: table({
    columns: {
      id: text().primaryKey(),
      authorId: text().notNull().references('users', 'id'),
      title: text().notNull(),
      body: text().notNull(),
      published: boolean().notNull().default('false'),
      createdAt: timestamp().notNull().default('now()'),
    },
  }),
});
```

```ts
// briven/functions/listPosts.ts
import { query, type Ctx } from '@briven/cli/server';

interface Args { authorId: string }

export default query(async (ctx: Ctx, args: Args) => {
  return ctx
    .db('posts')
    .select(['id', 'title', 'createdAt'])
    .where({ authorId: args.authorId, published: true })
    .orderBy('createdAt', 'desc')
    .limit(50);
});
```

```tsx
// any react component
import { useQuery } from '@briven/react';

export function PostList({ authorId }: { authorId: string }) {
  const { data } = useQuery('listPosts', { authorId });
  return <ul>{data?.map((p) => <li key={p.id}>{p.title}</li>)}</ul>;
}
```

that's the whole loop. `briven deploy` ships the schema + functions, `useQuery` makes the read reactive, every insert/update/delete on `posts` re-runs the query for anyone subscribed. there's no separate channel setup. no manual invalidation. the function body doesn't change between "static read" and "reactive read" — the client decides.

## the parts I think are non-obvious

**postgres is the boundary, not the abstraction.** convex stores in a proprietary engine. supabase is on postgres but the realtime layer reads the wal and re-encodes everything through their api. briven's reactivity uses postgres's own LISTEN/NOTIFY — the triggers are generated from your schema, the notifications hit a thin websocket service, the function re-runs. no shadow data layer. if you want to write SQL, write SQL. if you want a backup, `pg_dump`.

**ai is built in, on your hardware.** schema generator, function generator, code explainer, and a docs assistant — all running on a self-hosted Qwen 2.5-coder model. no third-party AI provider, no data egress. for self-hosters with a gpu, point briven at your ollama and it's free. for briven.tech customers, the inference runs on a server in the EU under flndrn Limited's control.

**migrations are first-class.** there's a documented playbook for moving from convex, supabase, firebase, prisma, drizzle, raw postgres, hasura, nextauth, and mongodb. each is its own page on docs.briven.tech with the actual decision matrix — when to keep an embedded document as `jsonb` vs flatten it, when to use ULIDs vs preserve external IDs, when to do a parallel-run window vs a hard cutover.

**the licence is open-core, not source-available.** the engine is AGPL-3.0. the SDKs and CLI are MIT. if you want to run a hosted service on briven-core or bundle it into a closed product, there's a commercial licence — but the default path is open. you can fork the whole thing today.

## what briven is NOT

- a serverless platform. functions deploy to a long-running deno isolate per project. cold starts are a one-time thing, not a per-request thing.
- a graphql backend. rest + websocket only.
- a multi-region platform on day one. self-host wherever; briven.tech is EU-only until phase 4.
- a replacement for your existing postgres if you already have a good rls setup. briven enforces auth in function code, not at the database level. it's the right trade for new projects; for migrations from supabase-with-rls it's an explicit re-pattern.

## what's working today

briven.tech is live in private beta. the four services (api, runtime, realtime, web) run on a single host behind traefik. ai surface is live for schema / function / explain / docs assistant. polar billing is wired for pro and team tiers; usage metering pushes invocations, storage, and realtime connection-seconds to polar meters every hour. status page at docs.briven.tech/status (status.briven.tech subdomain landing in a few weeks).

self-host is one command:

```bash
git clone https://code.konnos.org/flndrn/briven
cd briven/infra/dokploy
cp .env.example .env  # set BRIVEN_DOMAIN + secrets
docker compose up -d
```

GHCR images are also available if you'd rather pull than build.

## what's next

- the rest of the migration cycle — three of my own products move onto briven.tech in the next eight weeks. mavi finans (regulated fintech) is the last and the hardest; that migration is the real proof.
- public beta opens after a 60-day clean window. that's the kill-or-ship signal — if briven holds up under my own production traffic for two months, external sign-ups land.
- branching / preview environments. it's the most-requested feature and explicitly out of scope for year one. coming in year two if briven survives year one.

## try it

- docs · https://docs.briven.tech
- source · https://code.konnos.org/flndrn/briven
- discord · *link once private-beta cohort fills*
- briven.tech invites are limited to ~25 hand-picked beta users right now. if you're migrating off a managed reactive backend and want to be in that cohort, email j@briven.tech with a one-paragraph description of what you're moving.

— j

---

*end of draft. things to confirm before publishing:*

- *the discord link, once the server is up and the invite is permanent*
- *the GHCR image names match what `release.yml` actually publishes*
- *the "60-day clean window" sentence — is that a public commitment we want to make, or a private gate? if private, soften to "when it's ready"*
- *the screenshot/asset list (see assets.md)*
- *publication date — coordinate with Show HN submission window (tuesday/wednesday morning PT works best)*
