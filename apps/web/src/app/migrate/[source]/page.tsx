import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BackgroundGrid } from '../../../components/marketing/background-grid';
import { MigrationLeadForm } from '../../../components/marketing/migration-lead-form';
import { SiteFooter } from '../../../components/marketing/site-footer';
import { SiteHeader } from '../../../components/marketing/site-header';
import { TrackPageView } from '../../../components/marketing/track-page-view';
import { getSessionUser } from '../../../lib/session';

interface SourceDetail {
  slug: string;
  name: string;
  hero: string;
  whyLeave: string;
  // Three reassurance bullets — what the customer is afraid of, named
  // explicitly and resolved.
  fears: readonly { title: string; body: string }[];
  // The conceptual mapping in their language → briven's.
  mappings: readonly { from: string; to: string }[];
  // Honest, ranked: what comes for free, what we automate, what's manual.
  effortLines: readonly { effort: 'free' | 'auto' | 'manual'; body: string }[];
  // FAQ — answers questions someone evaluating the migration actually has.
  faq: readonly { q: string; a: string }[];
}

// Marketing per-source pages. Read at request time so we can ship one
// page file and nine SourceDetail entries instead of nine route files.
const SOURCES: Record<string, SourceDetail> = {
  convex: {
    slug: 'convex',
    name: 'convex',
    hero: 'your reactive backend, on plain postgres.',
    whyLeave:
      'convex pioneered the reactive-queries pattern briven adopts. the difference is the floor: convex stores your data in its own engine; briven stores it in plain postgres, which means pg_dump moves your whole product anywhere — convex, supabase, a self-hosted server, anywhere. same reactivity, no proprietary database.',
    fears: [
      {
        title: 'will my useQuery hooks change?',
        body: "no — briven's useQuery() matches convex 1:1. swap the import to @briven/client-react and your react tree compiles unchanged.",
      },
      {
        title: 'what happens to my data during the move?',
        body: "we copy it. your convex deployment stays running and untouched. nothing on convex is deleted or modified — we read, we write a copy into briven, you keep both running in parallel until you flip writes.",
      },
      {
        title: 'how long will i be in a weird half-migrated state?',
        body: 'as long as you want. parallel-run is mandatory; cutover is your decision. we keep convex warm for 7 days after cutover as a one-click rollback target.',
      },
    ],
    mappings: [
      { from: 'defineTable() with v.string() / v.number() / v.id()', to: 'briven schema DSL: text(), bigint(), text().references()' },
      { from: 'query() / mutation() / action() (multiple per file)', to: 'one default export per file under briven/functions/' },
      { from: 'v.id("users") → fk to users table', to: 'text().references("users", "id")' },
      { from: 'ctx.db.query("notes").withIndex(...).collect()', to: 'ctx.db("notes").select().where({ ... }).orderBy(...)' },
      { from: 'useQuery("getNotes", args) on the client', to: 'useQuery("getNotes", args) — same signature' },
      { from: 'clerk / auth0 / convex auth', to: 'Better Auth (email + magic-link + OAuth)' },
    ],
    effortLines: [
      { effort: 'free', body: 'data export — `npx convex export` already dumps every table to one zip; we read it directly.' },
      { effort: 'auto', body: 'schema translation — your TS schema in convex/schema.ts ports to briven schema DSL via our walker.' },
      { effort: 'auto', body: 'function translation — query / mutation / action handlers port to briven/functions/*.ts; the 80% pattern-matchable cases are translated automatically with diffs you review.' },
      { effort: 'manual', body: 'scheduler primitives — `ctx.scheduler.runAfter(...)` doesn’t exist in briven yet. we replace with a pg_cron entry or an action-driven sleep-and-poll.' },
      { effort: 'manual', body: 'auth cutover — convex auth doesn’t translate. we either preserve user ids during data import (so foreign keys still resolve) or force a one-time sign-in. you pick.' },
    ],
    faq: [
      { q: 'how much downtime?', a: 'zero. your convex deployment serves traffic the entire migration. cutover is a DNS / client config flip you control. parallel-run lasts as long as you want.' },
      { q: 'what about my custom server-side functions?', a: 'we port each one and flag the cases we can’t auto-translate (custom 3rd-party SDKs, ctx.scheduler, ctx.storage). you review every translated file before it ships.' },
      { q: 'can i go back to convex?', a: 'yes, for 7 days after cutover. we keep your convex deployment in read-mirror sync with briven during that window. if you press rollback, your customers see no break.' },
      { q: 'is briven really cheaper than convex?', a: 'roughly. compare pricing at /pricing — briven\'s free tier is more generous for small projects, and the paid tier scales linearly on storage + invocations instead of convex\'s opaque bundling.' },
    ],
  },

  supabase: {
    slug: 'supabase',
    name: 'supabase',
    hero: 'supabase + convex-style reactivity, on the same postgres.',
    whyLeave:
      'supabase exposes postgres directly through postgrest + row-level security; briven puts a typed function layer in front and adds convex-style reactive subscriptions. you keep the postgres you already trust, with proper functions and reactive queries on top.',
    fears: [
      {
        title: 'will i lose my data?',
        body: "no. it's postgres on both ends. pg_dump | pg_restore moves every row to briven without translation. row-counts match exactly.",
      },
      {
        title: 'what happens to my row-level security policies?',
        body: 'they become explicit guards inside your briven functions. instead of `auth.uid() = user_id` in SQL, you write `if (ctx.session.userId !== row.userId) throw forbidden`. you can read the rule in code.',
      },
      {
        title: 'do my edge functions port?',
        body: 'directly. supabase edge functions (Deno) port to briven functions (also Deno-isolate based). the request/response signature is the same shape.',
      },
    ],
    mappings: [
      { from: 'supabase create table', to: 'briven schema DSL → identical postgres tables' },
      { from: 'row-level security policy', to: 'explicit guard in the briven function (readable, debuggable)' },
      { from: 'supabase edge functions (Deno)', to: 'briven functions (Deno isolates) — same runtime, same imports' },
      { from: 'supabase auth (GoTrue)', to: 'Better Auth — email + magic-link + OAuth. user ids preserved.' },
      { from: 'supabase realtime (postgres replication)', to: 'briven realtime (LISTEN/NOTIFY + WS). useQuery() hook.' },
      { from: 'supabase storage', to: 'briven storage (S3-compatible MinIO under the hood)' },
    ],
    effortLines: [
      { effort: 'free', body: 'data move — pg_dump from supabase, pg_restore into briven\'s data plane. no transformation.' },
      { effort: 'auto', body: 'schema port — the schema is already postgres; we just bring it across.' },
      { effort: 'auto', body: 'edge functions — port directly. same Deno-isolate runtime, same Web standard APIs.' },
      { effort: 'manual', body: 'RLS → function guards — every policy gets rewritten as an explicit check inside the function that replaces the affected query. tedious; mechanical.' },
      { effort: 'manual', body: 'supabase auth → Better Auth — user table copies cleanly. OAuth providers reconfigure. one-time fresh sign-in for password users.' },
    ],
    faq: [
      { q: 'will my client-side @supabase/supabase-js calls still work?', a: 'no — you swap that client for @briven/client-react. but the queries you used to write inline as postgrest filters become typed briven functions instead, which is a clarity upgrade.' },
      { q: 'what about my supabase storage buckets?', a: 'briven storage is S3-compatible (MinIO). we mirror your buckets one-to-one and rewrite your client-side upload URLs.' },
      { q: 'are realtime subscriptions faster on briven?', a: 'comparable. briven uses LISTEN/NOTIFY where supabase uses logical replication. both deliver <100ms updates for typical loads.' },
      { q: 'what about pgvector / postgis / other extensions?', a: 'briven\'s postgres is the same postgres — extensions you used on supabase work on briven if your tier permits. pgvector is enabled by default.' },
    ],
  },

  firebase: {
    slug: 'firebase',
    name: 'firebase / firestore',
    hero: 'firestore in your head, postgres on the floor.',
    whyLeave:
      'firebase is nosql with realtime built-in. briven is real sql on postgres with realtime built-in. the hardest part of moving off firebase is the modelling — document → relational requires shape decisions per collection. we walk through them with you. we don\'t just dump.',
    fears: [
      {
        title: 'do i have to redesign my data model?',
        body: 'some of it, yes — but we don\'t make you do it alone. briven samples your documents per collection and proposes a relational schema (flatten vs jsonb per field). you review every collection before we commit.',
      },
      {
        title: 'what about my realtime listeners?',
        body: 'they become briven useQuery() hooks. the callback-based snapshot model maps cleanly to react hooks; the wire model is different but the developer ergonomics are familiar.',
      },
      {
        title: 'do my users keep their accounts?',
        body: 'yes. firebase auth users (email/password + OAuth) port to Better Auth. we preserve provider+subject pairs so a "sign in with Google" user lands on their existing account, no fresh signup.',
      },
    ],
    mappings: [
      { from: 'firestore collection', to: 'postgres table with shape decisions per field' },
      { from: 'embedded subdocument', to: 'jsonb column OR child table (your choice during review)' },
      { from: 'firestore document id', to: 'text column with ULID for new rows' },
      { from: 'firebase auth (Google/Apple/email)', to: 'Better Auth — providers reconfigure 1:1' },
      { from: 'realtime onSnapshot listener', to: 'useQuery() — react hook, same wire-level guarantees' },
      { from: 'firebase storage', to: 'briven storage (S3-compatible, MinIO)' },
      { from: 'firebase functions (gen 2)', to: 'briven functions (Deno isolates)' },
    ],
    effortLines: [
      { effort: 'auto', body: 'data export — firebase admin SDK dumps every collection. we stream it.' },
      { effort: 'auto', body: 'schema proposal — we sample your documents and propose a postgres schema. you review per collection before we commit.' },
      { effort: 'auto', body: 'auth — firebase auth users map to Better Auth, preserving provider+subject. existing OAuth users land on their account on first sign-in.' },
      { effort: 'manual', body: 'shape decisions — for each collection, you decide: flatten into columns? jsonb blob? hybrid? we propose, you approve.' },
      { effort: 'manual', body: 'cloud functions — port to briven functions; gen-2 Deno-style functions are close, but firebase-specific SDKs become postgres queries.' },
      { effort: 'manual', body: 'security rules → function guards — every rule becomes an explicit check inside the briven function that replaces the firestore access.' },
    ],
    faq: [
      { q: 'isn\'t document → relational just downgrading?', a: 'no — briven supports jsonb columns, which give you document-store flexibility *inside* a relational schema. you can keep nested docs as opaque jsonb and only flatten the fields you query on. best of both.' },
      { q: 'how long does a firebase migration take?', a: 'longer than the others. we recommend a 2-week parallel-run window for non-trivial firebase apps because shape decisions surface over time. quoted as ~3-5 days of operator time.' },
      { q: 'what about firebase\'s offline persistence?', a: 'briven\'s client-side cache covers offline reads. offline writes require app-level queueing — same as firebase, just less invisible.' },
      { q: 'will my flutter / unity / SwiftUI app work?', a: 'briven has REST + WS endpoints that any client can hit. official SDKs are TS-only today; native clients ship over the next two quarters.' },
    ],
  },

  mongodb: {
    slug: 'mongodb',
    name: 'mongodb',
    hero: 'document flexibility, postgres durability.',
    whyLeave:
      'mongodb gave you schema flexibility; briven\'s jsonb columns + postgres tables give you the same thing without the operational surface of a separate database. and you get convex-style reactivity for free on top.',
    fears: [
      {
        title: 'do i have to flatten every nested document?',
        body: 'no — fields you don\'t query on stay as jsonb. the rule we apply: if you ever filter or sort on a field, flatten it into a column. otherwise leave it in jsonb. you review per collection.',
      },
      {
        title: 'what about ObjectId, my embedded refs, $lookup pipelines?',
        body: 'ObjectIds become text columns with ULIDs for new rows. embedded refs become foreign keys. $lookup pipelines become postgres joins, which are faster.',
      },
      {
        title: 'can i still use aggregation-style queries?',
        body: 'yes — postgres has window functions, CTEs, and json operators. anything mongo aggregation does, postgres does too. usually faster.',
      },
    ],
    mappings: [
      { from: 'collection', to: 'table (with jsonb columns where appropriate)' },
      { from: 'ObjectId', to: 'text + ULID for new rows; preserved for existing rows' },
      { from: 'embedded document', to: 'jsonb column OR child table (decide per field)' },
      { from: '$lookup aggregation', to: 'JOIN in a briven function (faster, indexable)' },
      { from: 'mongoose schema validation', to: 'zod validation inside the briven function' },
      { from: 'change streams', to: 'useQuery() reactivity on touched tables' },
    ],
    effortLines: [
      { effort: 'auto', body: 'data export — mongoexport per collection, streamed.' },
      { effort: 'auto', body: 'schema proposal — we sample documents and propose a relational schema. you decide per field: flatten or jsonb.' },
      { effort: 'manual', body: 'shape decisions — same as firebase. document-store data needs human review to land well in postgres.' },
      { effort: 'manual', body: 'application-side queries — mongoose / native driver calls become ctx.db chains. mechanical but tedious.' },
    ],
    faq: [
      { q: 'won\'t i lose flexibility?', a: 'only where it was hurting you. jsonb columns preserve schemaless storage for the fields where flexibility helped; flattened columns add indexes + foreign keys where you wanted them.' },
      { q: 'what about atlas vector search?', a: 'briven has pgvector enabled by default. vector search works on the same postgres; you don\'t need a separate vector store.' },
      { q: 'how does the move compare to migrating to documentdb / cosmos?', a: 'simpler. those are still document stores with mongo-compatible APIs; briven is a fundamentally different data model. but the migration is more thoughtful — you exit nosql, you don\'t just sideways-port.' },
    ],
  },

  drizzle: {
    slug: 'drizzle',
    name: 'drizzle',
    hero: 'same postgres. same TS schema. plus reactivity, functions, hosting.',
    whyLeave:
      'drizzle is a great query builder. briven is drizzle\'s shape + a hosted database + typed functions + reactive subscriptions + a deployment pipeline. you keep almost everything you already wrote.',
    fears: [
      {
        title: 'is briven\'s schema DSL different from drizzle\'s?',
        body: 'minimally. both target postgres. column types map 1:1 (text, integer, boolean, timestamp, jsonb, etc.). drizzle\'s `pgTable()` becomes briven\'s `table()`. relations and indexes carry over.',
      },
      {
        title: 'do i lose my drizzle migrations?',
        body: 'no — we pg_dump your data from whatever postgres drizzle was pointing at. your existing schema lands intact. briven owns future migrations going forward.',
      },
      {
        title: 'will my db calls still be type-safe?',
        body: 'yes. briven\'s ctx.db is fully typed against your schema. inferred row types, inferred where-clause shapes, etc. — drizzle\'s big strength carries.',
      },
    ],
    mappings: [
      { from: 'drizzle pgTable("notes", { ... })', to: 'briven table({ ... }) — same column builders' },
      { from: 'drizzle relations', to: 'briven foreign keys + JOIN helpers' },
      { from: 'db.select().from(notes).where(eq(notes.id, x))', to: 'ctx.db("notes").select().where({ id: x })' },
      { from: 'your own pg-pool deployment', to: 'briven managed postgres + connection pooling' },
      { from: 'manual migration files', to: 'briven\'s schema diff → auto-generated migrations on deploy' },
    ],
    effortLines: [
      { effort: 'free', body: 'data — your postgres becomes briven\'s postgres via pg_dump | pg_restore.' },
      { effort: 'auto', body: 'schema translation — drizzle schema.ts ports almost line-for-line to briven\'s DSL.' },
      { effort: 'manual', body: 'service-layer port — the code that calls drizzle becomes briven function files. one file per function. usually ~1 day for a medium app.' },
    ],
    faq: [
      { q: 'why move at all if i already have a working drizzle setup?', a: 'three reasons: (1) hosted postgres + connection pooling without ops, (2) reactive subscriptions via useQuery, (3) zero-config function deployment. if you\'re happy running pg yourself, you don\'t need briven.' },
      { q: 'can i keep drizzle alongside briven?', a: 'briven\'s ctx.db has the same shape but isn\'t literally drizzle. you swap one for the other in the function layer. you can absolutely use drizzle on a separate database (e.g., analytics) and briven for your reactive app.' },
      { q: 'what about drizzle studio?', a: 'briven studio at /dashboard/projects/{id}/studio is the same idea — table viewer, query runner, schema editor.' },
    ],
  },

  prisma: {
    slug: 'prisma',
    name: 'prisma',
    hero: 'leave prisma, keep postgres.',
    whyLeave:
      'prisma\'s schema.prisma format and client are powerful but lock you into prisma\'s migration model + their query engine. briven is the same postgres, with a typed query builder that doesn\'t need a code-generation step and ships with realtime + hosting.',
    fears: [
      {
        title: 'do i have to rewrite every PrismaClient call?',
        body: 'yes — but the new shape is similar. `prisma.notes.findMany({ where: { id } })` becomes `ctx.db("notes").select().where({ id })`. it\'s a find-and-replace exercise, not a redesign.',
      },
      {
        title: 'does my schema.prisma port automatically?',
        body: 'we parse schema.prisma and emit briven/schema.ts. field decorators map to briven column helpers. relations carry over. enums and check constraints translate.',
      },
      {
        title: 'do i lose prisma\'s migration history?',
        body: 'we keep your current schema state (that\'s what gets pg_dumped); briven owns future migrations. your old prisma migration files become reference docs, not active.',
      },
    ],
    mappings: [
      { from: 'schema.prisma model { ... }', to: 'briven table({ ... })' },
      { from: '@id @default(cuid())', to: 'text().primaryKey() + ULID at insert time' },
      { from: 'prisma relations (@relation)', to: 'briven foreign keys + JOIN helpers' },
      { from: 'PrismaClient.user.findMany({ where: ... })', to: 'ctx.db("user").select().where({ ... })' },
      { from: 'prisma generate (codegen)', to: 'no codegen — briven\'s ctx.db is inferred from your schema' },
      { from: 'prisma migrate dev', to: 'briven deploy — auto-diffs and generates the migration' },
    ],
    effortLines: [
      { effort: 'free', body: 'data — pg_dump from your prisma database, pg_restore into briven.' },
      { effort: 'auto', body: 'schema.prisma → briven/schema.ts translator. ~95% of fields are mechanical.' },
      { effort: 'manual', body: 'PrismaClient → ctx.db rewrite throughout your service layer. find-and-replace plus light editing.' },
      { effort: 'manual', body: 'prisma middleware → briven function middleware (auth checks, logging, etc.).' },
    ],
    faq: [
      { q: 'will i miss the prisma query engine?', a: 'briven\'s ctx.db is a thin typed wrapper over node-postgres / bun-sql. there\'s no separate query engine binary. for most apps this is faster and simpler.' },
      { q: 'what about prisma\'s soft-delete and audit extensions?', a: 'you\'ll write these as briven functions instead. it\'s less magical (no monkey-patching) and easier to debug.' },
      { q: 'does briven generate types from the schema?', a: 'yes, but inline at usage time — no separate codegen step. add a column, the types update.' },
    ],
  },

  postgres: {
    slug: 'postgres',
    name: 'raw postgres',
    hero: 'add reactivity, typed functions, and hosting to the postgres you already run.',
    whyLeave:
      'if you\'re running raw postgres + a hand-rolled service layer, briven is the smallest possible upgrade: same database, same SQL, but with a typed function layer, reactive subscriptions, and zero-config deploys on top.',
    fears: [
      {
        title: 'will my schema change?',
        body: 'no. we pg_dump your tables exactly as they are and pg_restore them into briven\'s data plane. column types, constraints, indexes — all preserved.',
      },
      {
        title: 'do i have to give up writing raw SQL?',
        body: 'no — briven\'s ctx.db.execute("...") is the SQL escape hatch. the typed builder is for the common case; raw SQL is one method call away.',
      },
      {
        title: 'what about my pg_cron / pg_partman / pg_stat_statements extensions?',
        body: 'briven\'s postgres is the same postgres. pgvector + pg_cron are enabled by default; we can enable additional extensions on your project tier.',
      },
    ],
    mappings: [
      { from: 'your schema.sql', to: 'briven schema DSL via introspection (one-shot script)' },
      { from: 'your service layer (express / fastify / etc.)', to: 'briven functions (one file per endpoint)' },
      { from: 'pgbouncer + connection pooling', to: 'briven\'s built-in pooling' },
      { from: 'your existing backup pipeline', to: 'briven\'s automated backups + your existing pg_dump pipeline still works' },
    ],
    effortLines: [
      { effort: 'free', body: 'data — pg_dump | pg_restore. zero transformation.' },
      { effort: 'auto', body: 'schema port — introspection script reads your information_schema and emits briven DSL.' },
      { effort: 'manual', body: 'service-layer port — your http handlers become briven functions. usually ~1 day for a medium app.' },
    ],
    faq: [
      { q: 'why not just keep my postgres setup?', a: 'you can. briven adds reactivity, typed deploys, and hosting; if you\'re happy with what you have, the only thing you\'re missing is reactive useQuery.' },
      { q: 'is briven\'s postgres different in any way?', a: 'postgres 17 with pgvector + pg_cron enabled. otherwise identical. you can `pg_dump` from briven to anywhere any day.' },
      { q: 'what about replication / read replicas?', a: 'on the team tier. brivens managed read replicas come online without a config change.' },
    ],
  },

  hasura: {
    slug: 'hasura',
    name: 'hasura',
    hero: 'the database moves for free. the work is the permissions port.',
    whyLeave:
      'hasura\'s GraphQL-over-postgres model is powerful but its metadata format makes the permission system hard to audit. briven exposes typed functions instead — every (role, table, action) rule becomes a readable check inside the function that replaces it.',
    fears: [
      {
        title: 'do i lose GraphQL?',
        body: 'as a wire protocol, yes — briven uses typed RPC over HTTP. for client developers, the ergonomics are similar (typed args, typed return). but the permission story is much clearer.',
      },
      {
        title: 'every action and event trigger... do they port?',
        body: 'yes. hasura actions become briven mutation functions; event triggers become outbound webhooks (briven ships with HMAC-signed webhook delivery built in).',
      },
      {
        title: 'how do i find every permission rule?',
        body: 'hasura\'s metadata.yaml lists every (role, table, action) triple. we walk it programmatically and emit one TypeScript guard per rule. you review.',
      },
    ],
    mappings: [
      { from: 'hasura tracked table', to: 'briven schema DSL (postgres carries directly)' },
      { from: 'metadata permission rule', to: 'explicit guard inside the briven function (readable, debuggable)' },
      { from: 'hasura action (webhook)', to: 'briven mutation function' },
      { from: 'hasura event trigger', to: 'briven outbound webhook subscriber (HMAC-signed)' },
      { from: 'remote schema', to: 'briven function that calls the remote API' },
    ],
    effortLines: [
      { effort: 'free', body: 'data — pg_dump from your hasura postgres, pg_restore into briven.' },
      { effort: 'auto', body: 'schema introspection — your existing postgres tables port to briven DSL.' },
      { effort: 'auto', body: 'event triggers → outbound webhooks — mechanical translation of metadata.' },
      { effort: 'manual', body: 'permissions port — every (role, table, action) rule becomes a TypeScript guard. tedious but readable. usually ~half a day per 50 rules.' },
      { effort: 'manual', body: 'client query port — GraphQL queries become typed briven function calls. shape-similar; rewrite is mechanical.' },
    ],
    faq: [
      { q: 'will my dashboards lose GraphQL introspection?', a: 'yes — briven doesn\'t do GraphQL. internal tools that depend on GraphQL introspection need rewiring to the briven HTTP API. mostly 1-day work.' },
      { q: 'can i keep hasura running for a while?', a: 'yes. parallel-run as long as you want. hasura points at the same postgres, briven points at briven\'s postgres copy; reads from either, writes to both during the window.' },
      { q: 'what about hasura cloud auto-scaling?', a: 'briven scales horizontally on the team tier. same auto-scaling story, no GraphQL-engine-specific knobs.' },
    ],
  },

  nextauth: {
    slug: 'nextauth',
    name: 'nextauth / auth.js',
    hero: 'same user table. same providers. typed functions + hosting on top.',
    whyLeave:
      'nextauth.js is auth-only — you still need a database, a service layer, and hosting. briven gives you all three, and because both ship Better Auth\'s table shape, the user migration is the simplest part.',
    fears: [
      {
        title: 'will my users have to sign in again?',
        body: 'usually no. briven uses Better Auth, and your nextauth users / accounts / sessions tables already match Better Auth\'s schema. we copy the rows; OAuth users land on their account on next sign-in without any action.',
      },
      {
        title: 'do my OAuth providers still work?',
        body: 'yes. configure the same Google / GitHub / Apple / etc. client IDs in briven, and existing provider+subject pairs resolve to existing accounts.',
      },
      {
        title: 'what about my getServerSession / useSession code?',
        body: 'replaced with briven\'s session helpers. shape is similar; types are stricter. light find-and-replace.',
      },
    ],
    mappings: [
      { from: 'nextauth users table', to: 'briven users table (same Better Auth shape)' },
      { from: 'nextauth accounts table', to: 'briven accounts table (1:1)' },
      { from: 'nextauth sessions table', to: 'briven sessions (1:1)' },
      { from: 'getServerSession(authOptions)', to: 'briven session helpers (server components: requireUser())' },
      { from: 'useSession() hook', to: 'briven\'s useSession (same shape)' },
      { from: 'authOptions.providers config', to: 'briven dashboard → providers (UI configuration)' },
    ],
    effortLines: [
      { effort: 'free', body: 'data — user/account/session tables copy directly. zero transformation.' },
      { effort: 'auto', body: 'provider config — point briven at your existing OAuth client IDs.' },
      { effort: 'manual', body: 'callsite migration — getServerSession + useSession references rewritten throughout your app.' },
    ],
    faq: [
      { q: 'will all my users keep their sessions?', a: 'yes if we copy the sessions table; everyone stays signed in. or we can force one fresh sign-in if you prefer cleaner state.' },
      { q: 'do i lose nextauth\'s middleware patterns?', a: 'briven uses route-level helpers (requireUser, requireSession). the patterns are similar; cleaner, less middleware-magic.' },
      { q: 'what about my custom adapter / database?', a: 'briven owns the database — you don\'t bring one. your custom adapter logic becomes briven function code.' },
    ],
  },
};

export function generateMetadata({
  params,
}: {
  params: Promise<{ source: string }>;
}): Promise<Metadata> {
  return params.then(({ source }) => {
    const s = SOURCES[source];
    if (!s) return { title: 'migrate to briven' };
    return {
      title: `migrate ${s.name} to briven — ${s.hero}`,
      description: s.whyLeave.slice(0, 160),
    };
  });
}

export function generateStaticParams(): { source: string }[] {
  return Object.keys(SOURCES).map((source) => ({ source }));
}

export default async function MigrateSourceMarketingPage({
  params,
}: {
  params: Promise<{ source: string }>;
}) {
  const { source } = await params;
  const detail = SOURCES[source];
  if (!detail) notFound();
  const user = await getSessionUser().catch(() => null);
  const startHref = user
    ? `/dashboard/projects/new/migrate/${detail.slug}`
    : `/signin?next=/dashboard/projects/new/migrate/${detail.slug}`;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <TrackPageView
        apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
        source={detail.slug}
      />
      <BackgroundGrid />
      <SiteHeader user={user} />

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-12 pt-16 sm:pt-24">
        <p className="font-mono uppercase tracking-[0.12em] text-[var(--color-primary)] text-[var(--text-xs)]">
          migrate / {detail.slug}
        </p>
        <h1 className="mt-4 font-sans font-medium leading-[1.05] tracking-[-0.03em] text-[var(--color-text)] text-[var(--text-display-3)] sm:text-[var(--text-display-2)]">
          {detail.hero}
        </h1>
        <p className="mt-6 max-w-2xl leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
          {detail.whyLeave}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href={startHref}
            className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-6 font-sans font-medium text-[var(--color-text-inverse)] shadow-[var(--shadow-sm)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-pressed)]"
          >
            start the {detail.name} migration
          </Link>
          <a
            href={`mailto:migrations@flndrn.com?subject=${encodeURIComponent(`${detail.name} → briven migration`)}`}
            className="inline-flex h-12 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-transparent px-6 font-sans font-medium text-[var(--color-text)] transition-colors duration-[var(--duration-fast)] ease-[var(--ease-briven)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-raised)]"
          >
            email a human first
          </a>
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          what you&apos;re afraid of
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {detail.fears.map((f) => (
            <div
              key={f.title}
              className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
            >
              <p className="font-mono text-sm text-[var(--color-text)]">{f.title}</p>
              <p className="leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          the conceptual mapping
        </h2>
        <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          your mental model survives the move. left column: what you call it in {detail.name}.
          right column: where it lives in briven.
        </p>
        <div className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)]">
          <table className="w-full font-mono text-xs">
            <thead className="bg-[var(--color-surface)]">
              <tr>
                <th className="px-4 py-3 text-left text-[var(--color-text-subtle)] uppercase tracking-wider">
                  {detail.name}
                </th>
                <th className="px-4 py-3 text-left text-[var(--color-text-subtle)] uppercase tracking-wider">
                  briven
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.mappings.map((m, i) => (
                <tr
                  key={i}
                  className="border-t border-[var(--color-border-subtle)] text-[var(--color-text-muted)]"
                >
                  <td className="px-4 py-3 align-top">{m.from}</td>
                  <td className="px-4 py-3 align-top text-[var(--color-text)]">{m.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          what the migration actually costs
        </h2>
        <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          ranked honestly: what comes for free, what we automate, what stays manual.
        </p>
        <ul className="mt-6 flex flex-col gap-3">
          {detail.effortLines.map((e, i) => (
            <li
              key={i}
              className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4"
            >
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${effortTone(e.effort)}`}
              >
                {effortLabel(e.effort)}
              </span>
              <p className="flex-1 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                {e.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          questions you actually have
        </h2>
        <dl className="mt-4 flex flex-col gap-4">
          {detail.faq.map((item, i) => (
            <div
              key={i}
              className="rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-5"
            >
              <dt className="font-mono text-sm text-[var(--color-text)]">{item.q}</dt>
              <dd className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16">
        <h2 className="font-mono uppercase tracking-[0.12em] text-[var(--color-text-subtle)] text-[var(--text-xs)]">
          ready to start? no signup needed
        </h2>
        <p className="mt-2 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-small)]">
          leave us your email and we&apos;ll reach out within one business day. your{' '}
          {detail.name} stays untouched the entire time.
        </p>
        <div className="mt-6">
          <MigrationLeadForm
            apiOrigin={process.env.NEXT_PUBLIC_BRIVEN_API_ORIGIN ?? ''}
            defaultSource={detail.slug}
            sources={Object.values(SOURCES).map((s) => ({ slug: s.slug, name: s.name }))}
          />
        </div>
      </section>

      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24">
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-primary)] bg-[var(--color-primary-subtle)] p-6">
          <h2 className="font-sans font-medium tracking-[-0.02em] text-[var(--color-text)] text-[var(--text-h3)]">
            already got a briven account?
          </h2>
          <p className="mt-3 leading-[1.6] text-[var(--color-text-muted)] text-[var(--text-body)]">
            jump straight into the in-product wizard for a more detailed intake form — you
            can save progress and track status from your dashboard.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={startHref}
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-5 font-sans font-medium text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)]"
            >
              open the dashboard wizard
            </Link>
            <Link
              href="/migrate"
              className="inline-flex h-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-5 font-sans font-medium text-[var(--color-text)] hover:border-[var(--color-border-strong)]"
            >
              compare all sources
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}

function effortLabel(effort: 'free' | 'auto' | 'manual'): string {
  return effort;
}

function effortTone(effort: 'free' | 'auto' | 'manual'): string {
  switch (effort) {
    case 'free':
      return 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary-subtle)]';
    case 'auto':
      return 'border-[var(--color-border-primary)] text-[var(--color-text)]';
    case 'manual':
      return 'border-[var(--color-warning)] text-[var(--color-warning)]';
  }
}
