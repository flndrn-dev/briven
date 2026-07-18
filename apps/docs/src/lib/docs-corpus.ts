/**
 * Hand-curated corpus index of every docs page. Used by the docs search
 * endpoint (and tomorrow by the AI docs assistant — the search picks the
 * top N pages by word-overlap, the assistant forwards them to Ollama).
 *
 * Each entry is one page. `summary` is what the page documents in 1-2
 * sentences — written as if you were describing the page to someone
 * trying to find the right one. Keywords matter; this is what the
 * search scores against.
 *
 * When you add a docs page, add an entry here. The pages list is short
 * (~25) so a hand-curated index reads faster than an automated one,
 * and the search results carry the editorial framing that the model
 * inherits when it builds its answer.
 */

export interface DocsCorpusEntry {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly keywords: readonly string[];
}

export const DOCS_CORPUS: readonly DocsCorpusEntry[] = [
  {
    slug: '/',
    title: 'briven docs · overview',
    summary:
      'landing page for briven docs. quick orientation: what briven is (open-core reactive postgres backend), who it is for (typescript developers), the four moving parts (api, runtime, realtime, web), and where to start.',
    keywords: ['overview', 'introduction', 'getting started', 'about', 'what is briven'],
  },
  {
    slug: '/undo',
    title: 'undo + snapshots · version history (doltgres / git-for-data)',
    summary:
      'briven runs on doltgres (postgres-wire git-for-data). plain-language undo and snapshots for non-coders, plus the developer SQL behind it: dolt_log, DOLT_HASHOF, DOLT_COMMIT, DOLT_TAG, dolt_tags, dolt_diff, dolt_diff_summary, DOLT_RESET, DOLT_BRANCH / DOLT_CHECKOUT / DOLT_MERGE. explains the dolt vs doltgres vs doltlab ecosystem and which one briven actually uses.',
    keywords: [
      'undo',
      'snapshot',
      'snapshots',
      'version history',
      'rollback',
      'restore',
      'time travel',
      'doltgres',
      'dolt',
      'doltlab',
      'git for data',
      'branch',
      'diff',
      'commit',
      'backup',
    ],
  },
  {
    slug: '/quickstart',
    title: 'quickstart · five minutes from clone to first invoke',
    summary:
      'convex-style start: briven setup (sign in + new or existing cloud project + wire this folder), edit schema/functions, deploy, invoke from the app. templates optional. also surfaces the dashboard-only path for studio-first users.',
    keywords: [
      'install',
      'setup',
      'briven setup',
      'init',
      'first',
      'cli install',
      'getting started',
      'tutorial',
      'first deploy',
      'convex',
    ],
  },
  {
    slug: '/connect',
    title: 'connect · shell setup, sdk, and mcp',
    summary:
      'how to connect to briven. recommended path 0: briven setup (one command — browser sign-in, create new or attach existing project, wire folder). path a: @briven/client sdk. path b: mcp for ai agents. documents platform session vs project keys.',
    keywords: [
      'connect',
      'briven setup',
      'setup',
      'login',
      'oauth',
      'cli auth',
      'sdk',
      'mcp',
      'api key',
      'brk_',
      'wire folder',
      'new project',
      'existing project',
    ],
  },
  {
    slug: '/cli',
    title: 'cli reference',
    summary:
      'every briven cli command — setup (recommended), connect, projects, init, login, link, deploy, dev, logs, db shell, env, invoke, export, import, doctor, whoami. one section per command with usage and flags.',
    keywords: [
      'cli',
      'briven setup',
      'briven init',
      'briven deploy',
      'briven dev',
      'briven logs',
      'briven login',
      'briven connect',
      'commands',
      'terminal',
    ],
  },
  {
    slug: '/schema',
    title: 'schema dsl reference',
    summary:
      'briven schema column helpers (text, bigint, boolean, timestamp, jsonb, uuid), modifiers (.primaryKey, .notNull, .references, .default, .unique, .nullable), index declarations, and the schema diff semantics that drive transactional migrations.',
    keywords: [
      'schema',
      'columns',
      'types',
      'tables',
      'migrations',
      'references',
      'foreign key',
      'index',
      'primary key',
      'dsl',
    ],
  },
  {
    slug: '/functions',
    title: 'functions reference',
    summary:
      'briven function wrappers — query() (reactive reads), mutation() (transactional writes), action() (long-running or external side effects). covers Ctx, db builder chains, brivenError, the lifecycle of a function call, and common patterns (validation, pagination, rate-limited writes).',
    keywords: [
      'functions',
      'query',
      'mutation',
      'action',
      'ctx',
      'ctx.db',
      'brivenError',
      'validation',
      'reactive',
      'transaction',
    ],
  },
  {
    slug: '/realtime',
    title: 'realtime — reactive queries',
    summary:
      'how reactive subscriptions work end-to-end: useQuery in the client, the realtime websocket service, postgres LISTEN/NOTIFY triggers auto-generated from the schema, and the re-invoke + push pipeline. covers connection limits, reconnection behaviour, and what makes a query reactive vs static.',
    keywords: [
      'realtime',
      'reactive',
      'websocket',
      'useQuery',
      'subscribe',
      'listen',
      'notify',
      'live',
      'updates',
      'subscriptions',
    ],
  },
  {
    slug: '/sdks',
    title: 'sdk reference — react, svelte, vue, vanilla',
    summary:
      '@briven/client (framework-agnostic), @briven/react (useQuery, useMutation hooks), @briven/svelte (stores), @briven/vue (composables). reconnect/backoff behaviour, ssr considerations, and how token auth flows from the dashboard to the SDK.',
    keywords: [
      'sdk',
      'client',
      'react',
      'svelte',
      'vue',
      'useQuery',
      'useMutation',
      'hooks',
      'composables',
      'stores',
    ],
  },
  {
    slug: '/api',
    title: 'http api reference',
    summary:
      'every public endpoint grouped by area: invoke, realtime, projects, deployments, studio, logs + stats, usage, api keys, project members, orgs, billing. method, path, auth, and a one-line summary each.',
    keywords: [
      'api',
      'http',
      'rest',
      'endpoints',
      'routes',
      'invoke',
      'deployments',
      'projects api',
    ],
  },
  {
    slug: '/self-host',
    title: 'self-host',
    summary:
      'run briven on your own infrastructure. four services (api, runtime, realtime, web) + postgres + redis + minio behind traefik. dokploy template, coolify template, plain docker compose. env vars, observability, licensing.',
    keywords: [
      'self-host',
      'self host',
      'docker',
      'docker compose',
      'dokploy',
      'coolify',
      'deploy',
      'infrastructure',
      'on-premise',
    ],
  },
  {
    slug: '/ai',
    title: 'ai features',
    summary:
      'briven ai surface: ai schema generator (NL prompt → draft schema.ts), ai function generator (NL + schema context → draft function file), ai explain code (snippet → plain-english walkthrough). all run on a self-hosted Qwen 2.5-coder model; prompts and outputs are not logged.',
    keywords: [
      'ai',
      'ollama',
      'qwen',
      'schema generator',
      'function generator',
      'explain code',
      'llm',
      'natural language',
    ],
  },
  {
    slug: '/examples',
    title: 'examples gallery',
    summary:
      'small end-to-end briven projects (realtime-chat, counter, …) with their full schema + functions + client wiring. each example is also available as a template via `briven init --template <name>`.',
    keywords: ['examples', 'samples', 'demo', 'realtime chat', 'counter', 'starter'],
  },
  {
    slug: '/templates',
    title: 'project templates',
    summary:
      'optional starter templates via `briven setup --template` or `briven init --template`. not the core product — only sample files. prefer briven setup to create/attach a cloud project.',
    keywords: [
      'templates',
      'starter',
      'briven setup',
      'briven init',
      'scaffold',
      'boilerplate',
    ],
  },
  {
    slug: '/migration',
    title: 'migration overview',
    summary:
      'how to migrate to briven from another backend. five principles (read before write, parallel-run, back up twice, schema-first, one product at a time), the ten-step playbook, and per-source guides (convex, supabase, postgres, drizzle, prisma, firebase, hasura, nextauth, mongodb).',
    keywords: [
      'migration',
      'migrate',
      'move',
      'switch',
      'convex',
      'supabase',
      'firebase',
      'postgres',
      'mongo',
    ],
  },
  {
    slug: '/migration/convex',
    title: 'migration · convex → briven',
    summary:
      'port a convex project: union-of-literal fields → text() with app-level validation; v.id() → text().references(); _creationTime → explicit created_at column; convex auth → better-auth.',
    keywords: ['convex', 'v.id', 'defineTable', 'union literal', 'migration from convex'],
  },
  {
    slug: '/migration/supabase',
    title: 'migration · supabase → briven',
    summary:
      'port a supabase project: schema 1:1 (both postgres), row-level-security policies → app-level guards in function code, edge functions → briven functions, storage → minio, auth → better-auth.',
    keywords: ['supabase', 'rls', 'edge functions', 'supabase storage', 'supabase auth'],
  },
  {
    slug: '/migration/postgres',
    title: 'migration · raw postgres → briven',
    summary:
      'the straightest path. schema.sql → briven/schema.ts via the dsl, pg_dump | pg_restore against the briven dsn, port handlers into briven/functions/.',
    keywords: ['postgres', 'raw postgres', 'sql', 'pg_dump', 'pg_restore', 'plain postgres'],
  },
  {
    slug: '/migration/drizzle',
    title: 'migration · drizzle → briven',
    summary:
      "drizzle schema ports almost 1:1; integer → bigint; .defaultNow() → .default('now()'); .references(() => …) → .references('table', 'column'); db.select chains become ctx.db chains.",
    keywords: ['drizzle', 'drizzle-orm', 'pgTable'],
  },
  {
    slug: '/migration/prisma',
    title: 'migration · prisma → briven',
    summary:
      'prisma dsl → briven dsl: @id/cuid/uuid → ulid in function code; Int → bigint; Json? → jsonb<T>().nullable(); enums as application-side validation; PrismaClient calls → ctx.db builder chains.',
    keywords: ['prisma', 'PrismaClient', 'schema.prisma', 'prisma migrate'],
  },
  {
    slug: '/migration/firebase',
    title: 'migration · firebase / firestore → briven',
    summary:
      'hardest path. document model → relational model is a manual remap. plan for an extended parallel-run window (2+ weeks) to catch shape mismatches.',
    keywords: ['firebase', 'firestore', 'document database', 'nosql'],
  },
  {
    slug: '/migration/mongodb',
    title: 'migration · mongodb → briven',
    summary:
      'collection → table with deliberate jsonb vs flatten decisions per embedded doc; ObjectId → text + ulid for new ids; mongoexport → custom transform → COPY for the data move.',
    keywords: ['mongodb', 'mongo', 'mongoose', 'ObjectId', 'jsonb', 'collection', 'document store'],
  },
  {
    slug: '/migration/hasura',
    title: 'migration · hasura → briven',
    summary:
      'postgres half ports for free; the work is the permissions port — every (role, table, action) triple from hasura metadata becomes a guard in function code.',
    keywords: ['hasura', 'graphql', 'permissions', 'role-based access'],
  },
  {
    slug: '/migration/nextauth',
    title: 'migration · nextauth / auth.js → briven',
    summary:
      'schema maps 1:1 (both target better-auth shape); provider port is trivial; the work is replacing getServerSession + useSession callsites and choosing preserve-ids vs preserve-sessions cutover.',
    keywords: ['nextauth', 'auth.js', 'getServerSession', 'useSession', 'better-auth'],
  },
  {
    slug: '/operator',
    title: 'operator guide',
    summary:
      'operating a briven deployment: env vars, b2 backup target, restore drills, alerting via discord, observability stack (grafana + loki + prometheus + alertmanager), upgrade procedures.',
    keywords: [
      'operator',
      'ops',
      'observability',
      'grafana',
      'loki',
      'prometheus',
      'backups',
      'restore',
      'alerts',
    ],
  },
  {
    slug: '/roadmap',
    title: 'roadmap',
    summary:
      'what is in briven today, what is queued for the next phase, what is deliberately out of scope for year one (light mode, mobile apps, graphql).',
    keywords: ['roadmap', 'plans', 'coming soon', 'phase 3', 'phase 4'],
  },
  {
    slug: '/support',
    title: 'support',
    summary:
      'where to ask for help, what to include in an issue, what NOT to paste (secrets, full session cookies, real user emails). private discord for beta users.',
    keywords: ['support', 'help', 'discord', 'community', 'contact'],
  },
  {
    slug: '/status',
    title: 'status',
    summary:
      'live health of api.briven.tech, realtime.briven.tech, runtime.briven.tech, and briven.tech itself. probes /health + /ready on each. red/green per service with latency + http status.',
    keywords: ['status', 'uptime', 'health', 'outage', 'incident', 'live'],
  },
  {
    slug: '/vector-search',
    title: 'vector search · pgvector + ctx.db.vectorSearch',
    summary:
      'first-class pgvector support. declare vector(N) on a column, call ctx.db(...).vectorSearch({column, vector, distance, limit}) for nearest-neighbour queries. supports L2 / cosine / inner-product distance. embedding generation is your call (briven proxies nomic-embed-text via the ollama backend).',
    keywords: [
      'vector',
      'pgvector',
      'embeddings',
      'semantic search',
      'nearest neighbor',
      'similarity',
      'hnsw',
      'cosine',
      'nomic',
    ],
  },
  {
    slug: '/ask',
    title: 'ask the docs · AI assistant',
    summary:
      'natural-language search across the docs corpus. retrieves the top 3 matching pages, answers your question grounded in those pages, cites the slugs. powered by the same self-hosted Qwen 2.5-coder backend as the dashboard ai surfaces.',
    keywords: ['ask', 'ai assistant', 'chat', 'question', 'help', 'search ai'],
  },
  {
    slug: '/changelog',
    title: 'changelog',
    summary:
      'reverse-chronological list of every notable change to briven, tagged by feat / fix / security / docs / infra / chore. also available as RSS at /changelog/feed.xml.',
    keywords: ['changelog', 'releases', 'updates', 'history', 'whats new'],
  },
  {
    slug: '/auth',
    title:
      'auth · @briven/auth sign-in, 2FA backup codes, testing tokens, sender domain, jwt+jwks',
    summary:
      'drop-in end-user sign-in: email + password, magic link, email OTP, passkeys, OAuth. install, pk_briven_auth keys, React/Vue/Svelte hooks, BrivenSignIn, two-factor + backup recovery codes, testing tokens for e2e (briven_test_… / signIn.testToken), password policy, new-device alerts, sender domain DNS, and verifiable JWT+JWKS for local session verification. agents: briven auth scaffold + AUTH-GO-LIVE-CHECKLIST.md.',
    keywords: [
      'auth',
      'sign in',
      'login',
      'magic link',
      'otp',
      'passkey',
      'oauth',
      'two-factor',
      '2fa',
      'mfa',
      'backup codes',
      'recovery codes',
      'testing tokens',
      'e2e',
      'test token',
      'password policy',
      'scaffold',
      'sender domain',
      'email domain',
      'custom domain email',
      'noreply',
      'spf',
      'dkim',
      'dns records',
      'email not arriving',
      'branding',
      'from address',
      'fallback sender',
      'jwt',
      'jwks',
      'token',
      'verifiable token',
      'verify session locally',
      'token endpoint',
      'json web key set',
      'key rotation',
      'new device',
      'rate limit',
    ],
  },
];

/**
 * Score one corpus entry against a query. Returns a number in [0, ∞);
 * 0 means no match. Higher = better. Algorithm: token overlap between
 * query and (title + summary + keywords), weighted by where the hit
 * lands — keyword hits score double, title hits triple.
 *
 * Tokenisation: lowercase, split on non-letter-digit. So "briven init"
 * and "briven-init" tokenise to ['briven', 'init'] and match the same
 * entries.
 */
export function scoreEntry(entry: DocsCorpusEntry, query: string): number {
  const tokens = tokenise(query);
  if (tokens.length === 0) return 0;
  const titleTokens = new Set(tokenise(entry.title));
  const summaryTokens = new Set(tokenise(entry.summary));
  const keywordTokens = new Set(entry.keywords.flatMap((k) => tokenise(k)));
  let score = 0;
  for (const t of tokens) {
    if (titleTokens.has(t)) score += 3;
    if (keywordTokens.has(t)) score += 2;
    if (summaryTokens.has(t)) score += 1;
  }
  return score;
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/**
 * Top-N matches for a query. Stable sort: higher score first, then
 * shorter slug (so '/cli' beats '/cli/some-deep-page' on a tie).
 */
export function searchDocs(query: string, limit = 5): readonly DocsCorpusEntry[] {
  const scored = DOCS_CORPUS.map((e) => ({ entry: e, score: scoreEntry(e, query) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.slug.length - b.entry.slug.length);
  return scored.slice(0, limit).map((s) => s.entry);
}
