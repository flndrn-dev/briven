# MIGRATION.md — migrating to briven cloud

This file is the authoritative migration guide. Drop it into any project you want to migrate onto briven cloud (alongside `CLAUDE.md`). It covers every starting point j's products are currently on, plus the common external-user cases for when this goes public in Phase 3.

> This doc gets battle-tested with every migration. If you hit a step that isn't covered or isn't right, fix it here first, then continue the migration. By the time external users read this, every sentence should be proven by a real migration.

---

## 0. When to use this doc

Use this when you have an existing project on one of:

- **convex** (hosted at convex.dev)
- **supabase** (hosted or self-hosted)
- **raw postgres** on a vps (dokploy postgres resource, hetzner, rds, neon, etc.)
- **prisma + postgres**
- **drizzle + postgres**
- **firebase / firestore** (see §8, harder path)

…and you want to move it to briven cloud (hosted) or a self-hosted briven-core instance.

Do NOT use this doc for:

- Moving between briven cloud projects — planned `briven export` + `briven import` (Phase 3, not yet implemented); for now, fall back to direct `pg_dump` / `pg_restore` against the data-plane Postgres
- Moving a briven project between regions — file a support ticket (support flow itself is Phase 3)
- Migrating only data without schema changes — use `pg_dump` + `pg_restore` directly

---

## 1. Core principles

Every briven migration follows the same five principles. If you violate these, you will lose data or break production.

1. **Read before write.** Never run a migration step until you've read this entire file once. Migrations that "go sideways" almost always do so at step 2 because someone skipped step 1.
2. **Parallel-run, don't switch.** For at least 48 hours, the old system and briven cloud run at the same time, with the same data, serving the same traffic. No cutover before the parallel-run window.
3. **Back up twice.** Before you touch anything, take two independent backups to two independent destinations. See §3.
4. **Migrate schema first, data second, functions third, traffic last.** In that order. Always.
5. **One product at a time.** Never migrate two things in parallel. The cognitive load of a migration is enough; do not double it.

---

## 1.5 briven cloud — what's live today vs still coming

Before you plan a migration, read this matrix. This doc describes the _intended_ migration flow, but not every piece is implemented yet. Rows flagged `⏳` require a manual fallback (documented inline where the command appears).

| Feature                                                                                                     | State               | Notes                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------- |
| Control-plane API (`api.briven.cloud`)                                                                      | ✅ live             | Hono on Bun, KVM4                                                                              |
| Control-plane Postgres (meta-DB)                                                                            | ✅ live             | Dokploy-hosted, `briven_control`                                                               |
| Data-plane Postgres (customer schemas)                                                                      | ✅ live             | Same KVM today; splits to dedicated in Phase 2 M3                                              |
| Dashboard (`dev.briven.cloud`)                                                                              | ✅ live             | Projects, billing, settings, admin pages all work                                              |
| Multi-tenant orgs (`organizations`, `org_members`)                                                          | ✅ live             | Every user has an auto-created `personal=true` org. See §2.5                                   |
| Better Auth via magic link (Resend)                                                                         | ✅ live             | `briven.session_token` cookie (prod: `__Secure-` prefix)                                       |
| GitHub OAuth                                                                                                | ⚙️ env wired        | Flow not verified end-to-end yet                                                               |
| Email + password auth                                                                                       | ⚙️ partial          | Better Auth supports it; not exercised                                                         |
| Polar billing (Free/Pro/Team), webhook sync                                                                 | ✅ live             | One subscription per org                                                                       |
| VIES live VAT validation on settings                                                                        | ✅ live             | `/v1/billing/vat/check` (debounced)                                                            |
| Schema DSL (`packages/schema`)                                                                              | ✅ exists           | Diff engine present; customer-project deploy path never exercised end-to-end                   |
| `briven` CLI commands: `init`, `login`, `logout`, `deploy`, `dev`, `db`, `env`, `logs`, `whoami`, `version` | ⚙️ present as files | Behaviour against a real customer project is untested — **zero completed deployments to date** |
| `briven link --create`                                                                                      | ⏳ not yet          | Use the dashboard's Projects → New UI for now                                                  |
| `briven import --from-convex <zip>`                                                                         | ⏳ not yet          | Use the manual script in §4                                                                    |
| `briven auth import --from-supabase <csv>`                                                                  | ⏳ not yet          | Use the manual SQL in §5                                                                       |
| `briven export`                                                                                             | ⏳ not yet          | Use direct `pg_dump` against the project's Postgres                                            |
| Realtime / reactive `useQuery`                                                                              | ⏳ skeleton         | `apps/realtime` is two files today. Phase 2 M1                                                 |
| Auto-generated `LISTEN/NOTIFY` triggers on schema diff                                                      | ⏳ not yet          | Phase 2 M1                                                                                     |
| Per-project file storage                                                                                    | ⏳ not yet          | Phase 3 — planning to use Cloudflare R2                                                        |
| Usage metering (invocations, DB size, bandwidth)                                                            | ⏳ not yet          | Phase 3 M1 / Phase 4 GA                                                                        |
| Rate limits per tier at gateway                                                                             | ⏳ not yet          | Phase 3 M1                                                                                     |
| Outbound network filter on runtime                                                                          | ⏳ not yet          | Phase 3 M1                                                                                     |
| Daily `pg_dump` → off-site backups                                                                          | ⏳ not set up       | Phase 0 exit criterion still open                                                              |
| Observability (Grafana / Loki / Prometheus)                                                                 | ⏳ not set up       | Phase 0 exit criterion still open                                                              |

**Rule of thumb for agents:** if a `briven <subcommand>` in this doc isn't in the row-list above as ✅, assume it doesn't work yet. Look for the manual fallback inline.

---

## 2. The 10-step migration playbook

This is the shape of every migration. Specific commands vary per source; §4-§8 cover those. **Every migration follows these 10 steps in order.**

### Step 1 — Inventory the source

Before touching anything:

- [ ] List every table, view, materialized view, function, trigger, extension, and scheduled job in the source database
- [ ] List every server-side function (queries, mutations, actions, edge functions, RPCs — whatever the source calls them)
- [ ] List every environment variable the project depends on
- [ ] List every external service the project calls (Resend, Stripe, S3 buckets, etc.)
- [ ] Document the auth model in plain language (providers, session storage, role model)
- [ ] Count rows per table — needed for step 7 verification
- [ ] Identify any dependent projects (does your marketing site read from this DB? Mobile app?)

Write this down in a `migration-inventory.md` next to this file. If you skip this step, later steps will surprise you.

### Step 2 — Set up the briven cloud project

**Prerequisites on your briven account before you start:**

- [ ] You have a briven account created via magic-link sign-in (GitHub OAuth is wired but flow-verification is pending — prefer magic link today).
- [ ] You have filled in your profile under Settings → Profile: **legal name**, **billing address**, and **VAT ID** if you are an EU business. These are _required_ before any Pro or Team checkout (the Polar checkout refuses without them). They are not required for Free-tier migrations.
- [ ] Your personal org has been created (this happens automatically at signup — nothing for you to do, but confirm `/v1/me` returns a `defaultOrgId` before proceeding).

**Project creation:**

- [ ] `briven login` (magic link today; GitHub OAuth ⚙️ pending verification)
- [ ] `briven init` in the target repo — this creates the `briven/` folder
- [ ] Create the project on briven cloud:
  - **Recommended (works today):** open the dashboard at `dev.briven.cloud/dashboard/projects`, click **New project**, choose name + slug + region. The project auto-attaches to your personal org.
  - **Planned (not yet implemented):** `briven link --create` from the CLI will do the same without leaving the terminal.
- [ ] Note down the project ID (format: `p_xxxxxxx`) and the admin key — store in 1Password/Bitwarden
- [ ] Configure the region — pick the briven region closest to your users (EU available today; US/APAC planned). Default is `eu-west-1`.

### Step 3 — Back up the source (twice)

Non-negotiable. Two backups to two destinations, both verified.

**For Postgres sources** (including Supabase, Dokploy Postgres, raw Postgres):

```bash
# Backup 1 — full dump, local disk
pg_dump --format=custom --compress=9 \
  "$SOURCE_DATABASE_URL" > ./backup-$(date +%Y%m%d-%H%M).dump

# Backup 2 — upload to object storage.
# Any S3-compatible destination works: Cloudflare R2, Backblaze B2,
# AWS S3, or self-hosted MinIO. Bucket name is your call — e.g.
# `briven-migration-backups`. If your briven account hasn't wired up
# off-site backups yet (Phase 0 item), set up an R2 or B2 bucket now
# and use it only for this migration.
aws s3 cp ./backup-*.dump s3://<your-migration-bucket>/$PROJECT_NAME/ \
  --endpoint-url https://<your-s3-endpoint>   # omit --endpoint-url if on AWS S3
```

**For Convex**:

```bash
npx convex export --path ./convex-backup-$(date +%Y%m%d).zip
# Then upload the zip to S3/Backblaze as backup 2
```

**Verify both backups:**

```bash
# Postgres: restore to a temp DB, count a known table
createdb migration_test
pg_restore -d migration_test ./backup-*.dump
psql migration_test -c "SELECT count(*) FROM <known-table>;"
# Must match the count from step 1

# Convex: unzip and inspect
unzip -l ./convex-backup-*.zip
# Must contain expected tables
```

**Do not proceed to Step 4 until both backups verify.**

### Step 4 — Port the schema

Translate the source schema into `briven/schema.ts`. This is a manual step the first time; subsequent migrations of similar shape get faster.

For each table in the source:

- [ ] Translate to `table("name", { ... })` in `briven/schema.ts`
- [ ] Translate column types (see type mapping table in §9)
- [ ] Translate indexes (`index()`, `uniqueIndex()`)
- [ ] Translate foreign keys (`refs("other_table.id")`)
- [ ] Translate defaults and `NOT NULL` / `null` semantics
- [ ] Translate any check constraints (add as `.check()` on the column)
- [ ] Add access rules: `{ access: { read: ..., write: ... } }` — derive from the source's RLS or function-level checks

Run `briven deploy --dry-run` to see the generated SQL diff. **Review it line by line** before proceeding. Make sure the generated migration would do what you expect.

### Step 5 — Port the functions

This is the biggest step and varies most by source. See §4-§8 for source-specific guidance.

General rules regardless of source:

- [ ] Every server-side function becomes a file in `briven/functions/`
- [ ] Classify each as `query` (read-only), `mutation` (writes), or `action` (external calls, non-transactional)
- [ ] Replace the source's client library (e.g. `useQuery` from convex, `createClient` from supabase) with `@briven/react` or `@briven/client`
- [ ] Keep function names identical to source where possible — reduces caller refactoring
- [ ] For each function, add a comment: `// Ported from <source>.<original-name> on <date>`

### Step 6 — Deploy schema + functions to briven (with empty data)

- [ ] `briven deploy` — this applies the schema migrations and deploys the functions
- [ ] Verify deployment: `briven logs --tail`
- [ ] Test a query function from a browser / curl against the new briven endpoint
- [ ] **Do NOT import data yet** — this deploy should land against an empty database so you can confirm the schema is right before you put data into it

### Step 7 — Import the data

Now, and only now, move the data.

**For Postgres sources:**

```bash
# Get the briven project's direct Postgres connection string.
# Preferred (planned): briven db connection-string --raw
#   [subcommand availability depends on briven CLI version — verify with `briven db --help` first]
# Fallback (works today): grab the DATABASE_URL for your project's schema
#   directly from the Dokploy dashboard → Postgres service → Connection string,
#   and scope it to the project's schema (format: proj_<base32 of projectId>).
export BRIVEN_DB_URL='postgres://briven:<password>@<data-plane-host>:5432/briven_data?options=-c%20search_path%3Dproj_<your-project-id>'

# Restore only the data (schema already in briven)
pg_restore \
  --data-only \
  --no-owner --no-privileges \
  --disable-triggers \
  -d "$BRIVEN_DB_URL" \
  ./backup-*.dump
```

**For Convex:**

The integrated importer is not implemented yet. Use the manual fallback:

```bash
# The Convex export zip contains a JSONL file per table + a manifest.
unzip ./convex-backup-*.zip -d ./convex-export

# For each table, write a small Node or Bun script that:
#   1. Reads ./convex-export/<tableName>.jsonl line by line
#   2. Remaps Convex field conventions:
#        _id           → id            (string, keep Convex's base32 id)
#        _creationTime → created_at    (ms epoch → ISO timestamptz)
#        v.id("t")     → FK text       (stays as the source Convex id string)
#        v.int64 values arrive as strings — parse or keep as bigint
#        v.array / v.object → jsonb (keep as-is, psql casts native JSON)
#   3. Inserts via `psql $BRIVEN_DB_URL -c "INSERT INTO ... VALUES (...)"` or,
#      preferably, builds a COPY ... FROM STDIN stream for throughput.
# Run the scripts one table at a time, in FK-dependency order.
#
# Planned (Phase 3): `briven import --from-convex <zip>` will do this for you.
```

**Verification (mandatory):**

- [ ] Row counts match the source (from Step 1 inventory) for every table
- [ ] Spot-check 3 known rows per critical table — the data looks right, not corrupted
- [ ] Foreign keys resolve (no orphan rows)
- [ ] `briven db shell` then `\dt+` — all tables present with expected sizes

**If any verification fails, rollback** (see §11) and restart from Step 6.

### Step 8 — Wire the app to briven (but don't cutover)

- [ ] Install `@briven/react` (or whichever client)
- [ ] Create a branch `migrate/briven`
- [ ] Set up a new env file `.env.briven` with briven credentials
- [ ] Keep the existing env file untouched
- [ ] Add a `NEXT_PUBLIC_BACKEND` feature flag: `"source" | "briven"` — default to `"source"` in production, `"briven"` in your dev
- [ ] Migrate one page at a time to read from briven behind the flag
- [ ] Smoke-test each migrated page locally + on a preview deployment

### Step 9 — Parallel run (48 hours minimum)

This is the step most teams skip. Don't.

- [ ] Deploy the feature-flagged app to production
- [ ] Leave the flag set to `"source"` for real user traffic
- [ ] Run a synthetic-traffic script that writes to BOTH source and briven every 5 minutes (health checks, dummy users, anything that exercises the critical paths)
- [ ] Run a row-count diff between source and briven every hour via cron
- [ ] Monitor briven's dashboard for errors, slow queries, failed functions
- [ ] After 48 hours of clean parallel run with zero drift: proceed
- [ ] If drift > 0 rows at any checkpoint, stop, investigate, do not cut over

### Step 10 — Cut over and verify

- [ ] Announce maintenance window (5-15 minutes — briven cutovers are fast, but allow margin)
- [ ] Pause synthetic traffic
- [ ] Run a final `pg_dump` of the source — this is your nuclear-option rollback
- [ ] Flip the feature flag to `"briven"` in production
- [ ] Verify: 10 smoke tests on the critical user paths
- [ ] Monitor error rates for 60 minutes — they should be indistinguishable from pre-cutover
- [ ] Announce migration complete
- [ ] **Leave the source running in read-only mode for 7 days** — you may need to reference it for a data question, but nothing can write to it
- [ ] After 7 days of clean operation, shut down the source

---

## 2.5 Organisations on briven cloud

briven cloud is multi-tenant at the **organisation** level, not the user level. When you sign up, a `personal=true` organisation is auto-created for you and you become its `owner` in `org_members`. Every project and every subscription attaches to an org via `org_id` — not to a user.

Why a migrating agent needs to know this:

- **Your new briven project lives inside your personal org.** Today's dashboard doesn't expose an org switcher (the switcher is Phase 3), so the UX is single-org-implicit — but the data model underneath is already multi-org.
- **`projects.org_id`, not `projects.owner_id`.** If the source project talks about "project owner," map that to the creator's personal org, not to a user FK. The `org_members` table carries per-user roles (`owner` / `admin` / `developer` / `viewer`); roles are _stored_ today but _not yet enforced_ (Phase 3).
- **`subscriptions.org_id` is UNIQUE.** One paid subscription per org, ever. If the source product had multiple billing relationships per user, collapse them to one-per-org; that's the shape briven uses.
- **Polar webhook metadata.** Checkouts carry `metadata.orgId`; legacy events redelivered from before the schema change also accept `metadata.ownerId` + fall back to that user's personal org.

**Tier caps** (not yet enforced by the API, but documented so the implementation matches when it lands):

- Free: 1 owned org, 1 seat (self)
- Pro: 3 owned orgs, 1 seat
- Team: unlimited owned orgs, 5 seats included + €15/extra (seat overage billing is Phase 3)

Being _invited to_ another org is allowed on every tier — the cap is only on orgs the user creates.

---

## 3. Backup policy — detailed

Backups are not optional. This section is what "back up twice" means concretely.

### Before the migration

- **Backup 1**: local disk, the machine doing the migration. Keep until Step 10 completes + 30 days.
- **Backup 2**: object storage (Backblaze B2, S3, etc.), different region from the source database. Keep for 90 days.

### During the parallel run

- **Backup 3**: take a fresh dump of briven at the start of the parallel run
- **Backup 4**: take a fresh dump of briven at the end of the parallel run, before cutover

### After cutover

- **briven cloud auto-backups kick in** — daily pg_dump per project, 30-day retention on Pro/Team
- For Pro+ projects: WAL archiving enables point-in-time recovery
- **Your own off-briven backup**: weekly `briven export` to your own S3 bucket, forever

---

## 4. Migrating FROM Convex

### Schema

Convex's document model translates to Postgres tables. Each Convex table becomes a briven table.

**Type mapping** (Convex → briven):

| Convex              | briven (in `schema.ts`)                      |
| ------------------- | -------------------------------------------- |
| `v.id("tableName")` | `text().refs("tableName.id")`                |
| `v.string()`        | `text()`                                     |
| `v.number()`        | `bigint()` (for ints) or `doublePrecision()` |
| `v.boolean()`       | `boolean()`                                  |
| `v.int64()`         | `bigint()`                                   |
| `v.array(...)`      | `jsonb()`                                    |
| `v.object({...})`   | `jsonb()`                                    |
| `v.optional(...)`   | `.null()` on the column                      |

### Functions

| Convex                                 | briven                                                    |
| -------------------------------------- | --------------------------------------------------------- |
| `query(async (ctx, args) => {...})`    | `query("name", async (ctx, args) => {...})`               |
| `mutation(async (ctx, args) => {...})` | `mutation("name", async (ctx, args) => {...})`            |
| `action(async (ctx, args) => {...})`   | `action("name", async (ctx, args) => {...})`              |
| `ctx.db.query("posts").collect()`      | `ctx.db.select().from(posts)`                             |
| `ctx.db.insert("posts", {...})`        | `ctx.db.insert(posts).values({...})`                      |
| `ctx.db.patch(id, {...})`              | `ctx.db.update(posts).set({...}).where(eq(posts.id, id))` |
| `ctx.db.delete(id)`                    | `ctx.db.delete(posts).where(eq(posts.id, id))`            |

### Client-side

| Convex                          | briven                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `useQuery(api.posts.list)`      | `useQuery("posts.list")` ⏳ non-reactive today; realtime is Phase 2 M1                           |
| `useMutation(api.posts.create)` | `useMutation("posts.create")`                                                                    |
| `ConvexProvider`                | `BrivenProvider` — verify the export exists in `@briven/client-react` before relying on the name |

**Reality check:** Convex's big differentiator is reactive queries. briven aims for the same, but `apps/realtime` is a skeleton today (two files). Until Phase 2 M1 ships, `useQuery` on briven is a one-shot fetch — no auto-updates. If your Convex app leans hard on reactivity, either (a) wait until the realtime service is done, or (b) plan to wrap briven calls with your own polling / TanStack Query until reactivity lands.

### Data

Manual import via the fallback in §2 Step 7 above. The integrated `briven import --from-convex <zip>` is planned (Phase 3) but not implemented today.

### What Convex has that briven doesn't (yet)

- **File storage**: Convex has built-in file storage. In briven, use MinIO/S3 via `@briven/storage` — syntax is similar, but uploads go through signed URLs rather than Convex's bundled upload API. Your file-handling code will need porting.
- **Scheduled functions**: Port to `briven/crons.ts`.
- **Convex Auth**: swap for Better Auth via briven's built-in auth.

---

## 5. Migrating FROM Supabase

### Schema

Supabase IS Postgres, so this is the simplest migration on the schema side. The schema is already SQL.

- [ ] `pg_dump --schema-only --no-owner "$SUPABASE_URL" > schema.sql`
- [ ] Translate each table to `briven/schema.ts` using `schema.sql` as the reference
- [ ] Explicitly port RLS policies to briven access rules in the schema DSL
- [ ] Translate every `CREATE FUNCTION` to a file in `briven/functions/`
- [ ] Translate every `CREATE TRIGGER` — briven _plans_ to generate CRUD triggers automatically from schema diff output (Phase 2 M1, ties into reactive-query pipeline), but that's not live today. For now, port every trigger yourself, including CRUD ones, as normal SQL inside an `action` function or via raw migration.

### Functions

Supabase has multiple places where logic lives:

- **Database functions** (SQL/PLPGSQL) → rewrite as `mutation` or `query` in TypeScript in `briven/functions/`
- **Edge functions** (Deno) → port as `action` in `briven/functions/` (briven also runs Deno, syntax is very close)
- **RPC calls** → become `query`/`mutation` in briven

### Client-side

| Supabase                               | briven                                         |
| -------------------------------------- | ---------------------------------------------- |
| `supabase.from("posts").select("*")`   | `useQuery("posts.list")` (define server-side)  |
| `supabase.from("posts").insert({...})` | `useMutation("posts.create")`                  |
| `supabase.rpc("fn_name", {...})`       | `useMutation("fn_name")`                       |
| `supabase.channel(...)`                | handled automatically by `useQuery` reactivity |
| `createClient()`                       | `createBrivenClient()`                         |

### Data

Straight `pg_restore --data-only` as per §2 step 7.

### Auth

Supabase Auth → Better Auth via briven. See §13 for briven's full auth model; the short version:

- [ ] Export the Supabase `auth.users` table: email + created_at + identity rows
- [ ] Import to briven's `users` + `accounts` tables. The integrated `briven auth import --from-supabase <csv>` is **not yet implemented** — for now, a manual SQL INSERT path:
  ```sql
  -- Run against briven_control (meta-DB).
  -- Preserve the Supabase user UUID as the external id on the accounts row,
  -- but give users a fresh ULID on the briven side (don't reuse the Supabase uuid as users.id — it'll break the `newId('u')` convention).
  INSERT INTO users (id, email, email_verified, created_at, updated_at)
    SELECT 'u_' || <new-ulid>, email, email_confirmed_at IS NOT NULL, created_at, now()
    FROM imported_supabase_users;
  INSERT INTO accounts (id, user_id, provider_id, account_id, created_at, updated_at)
    SELECT ... ;  -- one row per identity/provider link
  ```
- [ ] Users **will need to re-authenticate on first sign-in via magic link** — password hashes do not transfer (Better Auth doesn't import bcrypt from Supabase out of the box, and even if it did, that's the kind of security boundary you want to enforce anyway).
- [ ] The per-user **personal org** auto-provisions when they first hit `/v1/me` after signing in (side-effect of `getDefaultOrgForUser`). If you want to pre-seed orgs at import time instead, insert into `organizations` + `org_members` in the same transaction as the users insert.

### Storage

Supabase Storage → MinIO/S3 via briven. The file metadata table is yours to migrate; the actual files need to be copied bucket-to-bucket.

---

## 6. Migrating FROM raw Postgres

Easiest. If you're on raw Postgres already, briven is basically "Postgres plus reactive queries plus a CLI".

- [ ] Export schema: `pg_dump --schema-only --no-owner "$SOURCE_URL" > schema.sql`
- [ ] Translate to `briven/schema.ts`
- [ ] For any server logic, decide whether it becomes a briven function or stays in your application code (briven only takes what you want it to; queries can happen from your app directly if you prefer)
- [ ] Data: `pg_restore --data-only`

Nothing else to port.

---

## 7. Migrating FROM Prisma + Postgres or Drizzle + Postgres

These are "ORM + Postgres" setups where your schema is defined in TypeScript already.

### From Prisma

- [ ] `npx prisma db pull` to sync schema
- [ ] Read `schema.prisma` — translate each `model` to a briven `table()`
- [ ] `@id` → `.pk()`, `@unique` → `.unique()`, `@default(now())` → `.defaultNow()`, `@relation` → `.refs()`
- [ ] Prisma queries in your code (`prisma.post.findMany(...)`) can stay in your app or move to briven functions

### From Drizzle

- [ ] Drizzle schema is almost 1:1 with briven's schema DSL
- [ ] The column types are the same names (`text`, `integer`, `timestamp`, ...)
- [ ] Rename `pgTable("posts", {...})` → `table("posts", {...})` and change the import
- [ ] Drizzle queries (`db.select().from(posts)`) work unchanged inside briven functions

---

## 8. Migrating FROM Firebase / Firestore

The hardest migration. Firestore is document-oriented with no schema, so you must impose structure during the migration.

High-level:

- [ ] Export Firestore to JSON: `gcloud firestore export`
- [ ] Analyse the exported documents to derive a relational schema
- [ ] Define that schema in `briven/schema.ts`
- [ ] Write a one-off transformation script that reads the JSON export and writes to briven's Postgres via `briven db shell` or direct psql
- [ ] Port Firebase Functions (Node) → briven actions (Deno) — syntax shifts
- [ ] Port Firebase Auth → Better Auth via briven

Budget 3-5× the time of a Postgres migration. If you can, consider a staged approach: freeze Firestore writes, migrate, release with Firestore read-only for a week, then hard-cut.

---

## 9. Postgres type mapping (source column → `briven/schema.ts`)

| Postgres                     | briven DSL                                          |
| ---------------------------- | --------------------------------------------------- |
| `text`, `varchar`            | `text()`                                            |
| `integer`, `int4`            | `integer()`                                         |
| `bigint`, `int8`             | `bigint()`                                          |
| `smallint`                   | `smallint()`                                        |
| `boolean`                    | `boolean()`                                         |
| `real`, `float4`             | `real()`                                            |
| `double precision`, `float8` | `doublePrecision()`                                 |
| `numeric(p,s)`               | `numeric({ precision, scale })`                     |
| `timestamp`, `timestamptz`   | `timestamp()` / `timestamp({ withTimezone: true })` |
| `date`                       | `date()`                                            |
| `time`, `timetz`             | `time()`                                            |
| `uuid`                       | `uuid()`                                            |
| `jsonb`                      | `jsonb<T>()`                                        |
| `json`                       | `json<T>()`                                         |
| `bytea`                      | `bytes()`                                           |
| `text[]`                     | `array(text())`                                     |
| enum types                   | `enum("name", [...])`                               |
| `vector(N)` (pgvector)       | `vector({ dimensions: N })`                         |

---

## 10. Pre-migration checklist

Don't start the migration until ALL of these are true:

- [ ] You have read this entire document — especially §1.5 (feature matrix) so you know which commands have a manual fallback
- [ ] You have created `migration-inventory.md` (Step 1)
- [ ] You have both backups verified (Step 3) — including a proven destination (R2 / B2 / S3 / MinIO)
- [ ] You have 4+ hours of focused time ahead — no meetings, no interruptions
- [ ] You have rollback access to the source (admin credentials, not just the app's connection string)
- [ ] You have told anyone depending on the product that a migration window is coming
- [ ] Your briven cloud project is created and the admin key is stored
- [ ] Your briven profile has legal name + billing address filled in; VAT ID if EU (only _required_ for Pro/Team — Free works without)
- [ ] Your local dev environment can reach briven (`briven whoami` works)

---

## 11. Rollback procedures

If something goes wrong, use these in order of severity.

### Level 1 — parallel-run drift detected

- Stop the parallel-run synthetic traffic
- Investigate the drift — is it a bug in briven's migration, or a race in your sync script?
- Fix, reset briven's database from backup, restart parallel run
- Do not cut over

### Level 2 — post-cutover errors in the first 60 minutes

- Flip the feature flag back to `"source"`
- The source was running read-only for 7 days per Step 10, so you can flip back to it as-is
- If your source was already shut down, you've violated Step 10 rule — that's why the rule exists

### Level 3 — nuclear

- Restore Backup 1 (the final source dump from Step 10) to a fresh Postgres
- Point the app there
- briven project remains intact; investigate offline

### After any rollback

- Write an incident note in `migration-inventory.md`
- Identify the root cause
- Fix this file so the next person doesn't hit the same issue
- Schedule a retry

---

## 12. Post-migration cleanup

After 7 clean days post-cutover:

- [ ] Shut down the source database
- [ ] Remove the source connection string from your env (keep it in 1Password for emergencies, 90 days)
- [ ] Remove the feature flag from the codebase
- [ ] Remove the source client library (`@supabase/supabase-js`, `convex`, etc.)
- [ ] Remove unused environment variables from deployment platforms
- [ ] Update your project's `CLAUDE.md` to reflect the new stack
- [ ] Archive the migration branch
- [ ] Delete temporary backups (local disk); keep the off-site backup for 90 days
- [ ] Write a one-paragraph "migrated from X to briven on Y" note in the project's README

---

## 13. Authentication on briven

Every migration needs to answer "how do users sign in after the cutover." Here's what briven actually provides today.

### Primitives

- **Better Auth** is the library behind the scenes. briven wraps it; you don't call it directly from customer code.
- **Magic link via Resend** is the canonical sign-in flow — `/v1/auth/sign-in/magic-link` sends a one-time link, `/v1/auth/magic-link/verify` exchanges it for a session.
- **Session cookie**: `briven.session_token` in dev, `__Secure-briven.session_token` in prod (the `__Secure-` prefix enforces HTTPS + host-only per RFC-6265bis). Sessions live in the `sessions` table (`userId`, `token`, `expiresAt`, `ipAddress`, `userAgent`).
- **`users`, `accounts`, `sessions`, `verifications`** are the four auth tables in the control-plane meta-DB. `accounts` holds per-provider identity links (one row per OAuth provider the user uses); `verifications` holds short-lived magic-link tokens.
- **GitHub OAuth**: `BRIVEN_GITHUB_CLIENT_ID` / `BRIVEN_GITHUB_CLIENT_SECRET` are wired; the full flow is unverified end-to-end. If you're migrating from a GitHub-OAuth-dependent app, test the round-trip against `dev.briven.cloud` before relying on it.
- **Email + password**: supported by Better Auth, not exercised yet. If your source app requires it, either verify it works before migrating or fall back to magic link.

### Identity translation table

| Source                          | briven equivalent                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Convex Auth identity object     | briven session resolved via `c.get('user')` in Hono; `requireUser()` in Next.js RSC                                                    |
| Supabase `auth.users.id` (uuid) | briven `users.id` (ULID with `u_` prefix via `newId('u')`); store the source uuid on the `accounts.account_id` column for traceability |
| Supabase JWT claim              | briven session cookie; there is no JWT in the browser — session lookup happens server-side                                             |
| Firebase Auth `uid`             | same as Supabase (store as `accounts.account_id`, issue a new briven `users.id`)                                                       |
| Clerk / Auth0 `sub`             | same pattern                                                                                                                           |

### What you don't get to transfer

- **Password hashes** — different algorithms, different pepper, and you don't want that liability. Users re-authenticate on first sign-in post-cutover.
- **Sessions / tokens** — all sessions invalidate at cutover. Users sign in fresh.
- **Provider-specific refresh tokens** — re-issue via the briven OAuth flow at first sign-in.

### Where the org layer fits

Signing in authenticates you as a `users` row. On first call to `/v1/me`, briven resolves your **personal org** via `getDefaultOrgForUser` and returns it as `defaultOrgId`. Projects and subscriptions pivot through `org_id`; a signed-in user sees the union of projects across every org in `org_members`. You never have to think about the org layer from the client — the server always resolves it from the session.

### Post-cutover UX

On first sign-in after migration:

1. Magic-link email → `/v1/auth/magic-link/verify` → session cookie.
2. `/v1/me` → auto-creates the user's personal org if they were imported without one.
3. Profile is empty of VAT / billing address — user fills that in Settings → Profile before any Pro/Team checkout (Free works without it).

---

## 14. Support and escalation

If you're stuck:

- **Phase 0-2** (j's own migrations): update this doc with what broke, keep going
- **Phase 3** (private beta): a dedicated support channel will be announced — do **not** assume a mailto: address works today. Support channel is an explicit Phase 3 deliverable.
- **Phase 4+** (public): docs.briven.cloud/support, plus community channel

Never, ever blindly retry a migration step that failed. Read the error, read this doc's relevant section, then retry.

---

## 15. Changelog for this file

Every meaningful migration should teach this doc something. Append here.

- `2026-0X-XX` · initial draft, pre-handlr migration
- `2026-04-24` · Phase 0/2 reality check: added §1.5 feature matrix, §2.5 org layer, §13 auth details. Flagged CLI commands that don't exist yet (`briven link --create`, `import`, `export`, `auth import`) with manual fallbacks. Dropped prescriptive Backblaze references in favour of generic object storage language. First pass — no real migration has happened yet, so claims below §1.5 are intention-grade, not proven.
- `2026-0X-XX` · updated after handlr migration (first real test)
- `2026-0X-XX` · updated after cyclingtravel migration
- (etc.)

---

_End of MIGRATION.md_
