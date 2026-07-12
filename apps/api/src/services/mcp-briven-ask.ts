import { newId } from '@briven/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '../db/client.js';
import { mcpKnownAnswers } from '../db/schema.js';
import { log } from '../lib/logger.js';
import {
  validateStoredAnswer,
  writeGroundedAnswer,
  type GroundedAnswer,
} from './mcp-answer-writer.js';

/**
 * `briven_ask` — the general MCP reception desk (Build 3, owner-approved
 * 2026-07-07). Extends the auth bridge idea to EVERY briven functional area.
 *
 * THE ANSWERING CONTRACT (hard rule — a question is NEVER wiped off):
 * every answer has three parts, even when the asked-for feature does not
 * exist on briven:
 *   1. howBrivenWorksHere      — the honest platform picture for that area
 *   2. whatOurToolsGiveYou     — the closest primitives briven has today
 *   3. whatYouBuildInYourProject — the remaining gap the ASKING agent
 *      solves in its own codebase, with a concrete suggestion
 * plus a docs citation, so agents learn the official path.
 *
 * When no curated area matches, the tool still answers (platform overview +
 * docs index) AND files the question into the review stream (audit log) so a
 * briven session can extend these guides — the desk gets permanently smarter,
 * dead ends do not exist.
 *
 * Read-only. One-project key scope. Vendor names never appear in prose.
 */

const DOCS_BASE = 'https://docs.briven.tech';

/* ── the area guides — hand-curated, three-part contract ────────────── */

export interface BrivenAreaGuide {
  readonly id: string;
  readonly area: string;
  readonly keywords: readonly string[];
  readonly howBrivenWorksHere: string;
  readonly whatOurToolsGiveYou: readonly string[];
  readonly whatYouBuildInYourProject: readonly string[];
  readonly docs: string;
}

export const BRIVEN_AREA_GUIDES: readonly BrivenAreaGuide[] = [
  {
    id: 'database',
    area: 'database / tables / SQL',
    keywords: [
      'database', 'table', 'tables', 'sql', 'query', 'row', 'rows', 'column',
      'schema', 'insert', 'update', 'delete', 'join', 'index', 'postgres', 'doltgres',
    ],
    howBrivenWorksHere:
      'every project gets its own isolated postgres-compatible database (git-for-data ' +
      'under the hood: commits, branches, time-travel). you define tables via the schema ' +
      'DSL or the studio, and read/write through the SDK, HTTP API, or this MCP.',
    whatOurToolsGiveYou: [
      'MCP: list_tables, describe_table, query (read); create_table, insert, update, delete (write scope).',
      'MCP lifecycle: db_health + db_recovery_points (read); db_restart + db_recover (write scope); db_reprovision (admin keys) — for "database not responding" start with db_health, then db_restart.',
      'SDK: typed queries + mutations from @briven/client and the framework packages.',
      'versioning: undo/snapshots per the docs /undo page (dolt_log, DOLT_RESET, branches).',
    ],
    whatYouBuildInYourProject: [
      'your domain model and validation live in YOUR app — briven stores and versions the data, it does not encode your business rules.',
      'batch big imports through the bulk values array on insert to stay under per-minute rate limits.',
      'some postgres corners differ on the git-for-data engine (e.g. prepared statements, pg_index introspection) — if a query errors oddly, ask this tool with the exact error.',
    ],
    docs: `${DOCS_BASE}/schema`,
  },
  {
    id: 'app-data-access',
    area: 'reading & writing your data from a running app (any language / stack)',
    keywords: [
      'python', 'ruby', 'go', 'golang', 'rust', 'java', 'php', 'csharp', 'dotnet',
      'node', 'client', 'sdk', 'driver', 'connection', 'connect', 'dsn', 'psql',
      'libpq', 'orm', 'runtime', 'app', 'application', 'stack', 'language',
      'fetch', 'request', 'curl', 'read', 'write', 'crud', 'data',
    ],
    howBrivenWorksHere:
      'your running app never opens a raw sql connection to briven, and there is NO ' +
      '"run any sql with my key" http endpoint — that is deliberate: the same ' +
      'mediation that keeps every project sealed in its own database. instead an app ' +
      'reads/writes by calling small server FUNCTIONS that run next to the data, while ' +
      'agents and tooling use this MCP\'s data tools. this is identical for every ' +
      'language — the javascript sdk is a convenience wrapper over plain http, not a ' +
      'requirement.',
    whatOurToolsGiveYou: [
      'from ANY language (python, go, ruby, rust, java, …): POST https://api.briven.tech/v1/projects/<projectId>/functions/<functionName> with header "authorization: bearer <brk_ server key>" and a json body — that single http call IS the runtime data path, no sdk required.',
      'the brk_ key must be minted at role developer or higher to invoke functions; a lower-scope key returns 403.',
      'to define or inspect tables while building: this MCP — create_table, describe_table, query, insert, update, delete.',
      'javascript / typescript apps can use @briven/client (invoke + realtime subscribe) instead of hand-writing the fetch.',
    ],
    whatYouBuildInYourProject: [
      'write one small function per operation (e.g. saveRun, listRuns) that does the ctx.db work, deploy it with the cli, then call it over http from your app.',
      'there is no first-party sdk for python / go / etc yet — call the http endpoint directly (a one-line request in any http library). a missing convenience wrapper is NOT a reason to stand up a side database or ask for a raw sql login.',
      'keep the brk_ key in server-side env only, never in client / browser code.',
    ],
    docs: `${DOCS_BASE}/functions`,
  },
  {
    id: 'storage',
    area: 'file storage / uploads / sharing',
    keywords: [
      'storage', 'file', 'files', 'upload', 'download', 'bucket', 's3', 'image',
      'video', 'presigned', 'public', 'share', 'link', 'quota', 'transform',
    ],
    howBrivenWorksHere:
      'per-project object storage with presigned upload/download URLs, public-file ' +
      'toggles, tokenized public share-links, cross-project grants (strict-deny by ' +
      'default), image transforms, versioned recovery windows, and tiered quotas.',
    whatOurToolsGiveYou: [
      'MCP: storage_upload_url / storage_download_url / storage_list_files / storage_usage / storage_make_public / storage_transform_url, plus grants + share-links tools.',
      'S3-compatible keys via storage_mint_key for tooling that speaks S3.',
    ],
    whatYouBuildInYourProject: [
      'upload FROM THE BROWSER with the presigned URL — never proxy file bytes through your own server.',
      'store the returned file id in one of your tables to link files to your domain objects.',
      'check storage_usage before large ingests; quota blocks are tier-dependent.',
    ],
    docs: `${DOCS_BASE}/api`,
  },
  {
    id: 'functions',
    area: 'server functions / backend logic',
    keywords: [
      'function', 'functions', 'runtime', 'server', 'backend', 'mutation', 'action',
      'cron', 'endpoint', 'invoke', 'logic', 'webhook', 'ulid',
    ],
    howBrivenWorksHere:
      'you write typescript functions (queries, mutations, actions) that run ON briven ' +
      'next to your data — deployed via the CLI, invoked from the SDK or HTTP. the ' +
      'runtime exposes ctx.db, mutation/action helpers, ulid, and brivenError.',
    whatOurToolsGiveYou: [
      'CLI deploy of your functions folder; invoke via SDK or POST /v1/invoke.',
      'runtime helpers: mutation/action/ulid/brivenError (available since 2026-07-06).',
      'fault isolation: one broken function does not take down your other functions.',
    ],
    whatYouBuildInYourProject: [
      'keep functions small and data-close; orchestration and UI state belong in your app.',
      'for third-party calls (payment providers, external APIs) use an action, not a mutation.',
      'throw brivenError(code, message, {status}) for clean client-side error handling.',
    ],
    docs: `${DOCS_BASE}/functions`,
  },
  {
    id: 'realtime',
    area: 'realtime / live queries / subscriptions',
    keywords: [
      'realtime', 'live', 'subscribe', 'subscription', 'websocket', 'reactive',
      'push', 'sync', 'presence', 'update', 'instantly',
    ],
    howBrivenWorksHere:
      'reactive queries: the SDK subscribes to a query and briven pushes fresh results ' +
      'when underlying rows change — no polling loop on your side.',
    whatOurToolsGiveYou: [
      'SDK: useQuery-style reactive hooks in @briven/react (svelte stores / vue composables likewise).',
      'reconnect + backoff handled by the client; ws token flows from your keys automatically.',
    ],
    whatYouBuildInYourProject: [
      'design queries to be narrow (per-view) — a subscription re-runs on relevant writes.',
      'presence/typing-indicator style features: model them as small tables your clients write to; the reactive query does the fan-out.',
    ],
    docs: `${DOCS_BASE}/realtime`,
  },
  {
    id: 'auth',
    area: 'end-user auth / sign-in / auth emails',
    keywords: [
      'auth', 'login', 'signin', 'signup', 'magic', 'otp', 'passkey', 'oauth',
      'session', 'sender', 'email', 'domain', 'user', 'users', 'password',
      'jwt', 'jwks', 'token', 'verify',
    ],
    howBrivenWorksHere:
      'managed multi-tenant end-user auth (@briven/auth): email+password, magic link, ' +
      'OTP, passkeys, OAuth social — all per-project, configured in the dashboard. ' +
      'sessions live in a cookie (get-session checks them), and every project also ' +
      'exposes a token endpoint (short-lived signed JWT for the current user) plus a ' +
      'public JWKS endpoint, so your app can verify "is this user signed in?" locally ' +
      'without calling briven on every request.',
    whatOurToolsGiveYou: [
      'dedicated MCP tools on THIS connection: auth_config_get, sender_domain_status, auth_docs_ask — ask those for anything auth; they return live state + apply-steps.',
      'for JWT/JWKS local verification specifics, ask auth_docs_ask "verify session locally with tokens" — it returns both endpoints and the apply-steps.',
    ],
    whatYouBuildInYourProject: [
      'your sign-in UI (or the prebuilt <BrivenSignIn/>) wired with the browser-safe pk_briven_auth_ key.',
      'register every origin you serve from under dashboard auth → app domains.',
      'multi-app or own-backend setups: fetch GET /v1/auth-tenant/token from the signed-in browser and verify it on your server against GET /v1/auth-tenant/jwks with a standard JWT library, instead of a get-session round-trip per request.',
    ],
    docs: `${DOCS_BASE}/auth`,
  },
  {
    id: 'keys-api',
    area: 'api keys / HTTP api / integration',
    keywords: [
      'key', 'keys', 'api', 'http', 'rest', 'token', 'bearer', 'integrate',
      'external', 'curl', 'endpoint', 'scope',
    ],
    howBrivenWorksHere:
      'three key families: brk_* server data keys (never client-side), pk_briven_auth_* ' +
      'browser-safe auth keys, pk_briven_mcp_* MCP keys (this connection). every public ' +
      'capability is also reachable as plain HTTP under api.briven.tech/v1/*.',
    whatOurToolsGiveYou: [
      'dashboard → api keys: create/rotate/revoke, scoped read / read-write / admin.',
      'HTTP api reference on the docs /api page: invoke, data, storage, projects, usage.',
    ],
    whatYouBuildInYourProject: [
      'keep brk_ keys in server env vars only; rotate immediately if one ever leaks into chat/logs/git.',
      'server-to-briven calls: plain fetch with authorization: Bearer <brk_key> — no SDK required.',
    ],
    docs: `${DOCS_BASE}/api`,
  },
  {
    id: 'vector-search',
    area: 'vector search / embeddings / AI features',
    keywords: [
      'vector', 'embedding', 'embeddings', 'search', 'semantic', 'similarity',
      'ai', 'rag', 'llm', 'pgvector',
    ],
    howBrivenWorksHere:
      'vector columns + similarity search are built into the database (pgvector): store ' +
      'embeddings next to your rows and query with ctx.db.vectorSearch from functions.',
    whatOurToolsGiveYou: [
      'schema DSL vector column type; vectorSearch in the function runtime.',
      'docs /vector-search and /ai pages cover shapes and limits.',
    ],
    whatYouBuildInYourProject: [
      'embedding GENERATION is yours: call your embedding model in an action, store the result.',
      'chunking strategy and prompt assembly for RAG live in your app — briven is the store + search.',
    ],
    docs: `${DOCS_BASE}/vector-search`,
  },
  {
    id: 'hosting-deploy',
    area: 'hosting / deploying your app / environments',
    keywords: [
      'deploy', 'deployment', 'host', 'hosting', 'domain', 'production', 'staging',
      'environment', 'env', 'build', 'self', 'docker',
    ],
    howBrivenWorksHere:
      'briven hosts your DATA plane (database, storage, functions, auth, realtime). ' +
      'your app frontend/server is deployed wherever you host it — briven is not a ' +
      'website host. self-hosting the whole platform is documented for operators.',
    whatOurToolsGiveYou: [
      'stable public endpoints (api.briven.tech, your MCP) that work from any host.',
      'docs /self-host for running your own briven; /operator for running it in production.',
    ],
    whatYouBuildInYourProject: [
      'deploy your app with your own pipeline (your host / container platform); point it at briven via env vars (project id + keys).',
      'per-environment: use separate briven projects (or keys) for staging vs production rather than sharing one.',
    ],
    docs: `${DOCS_BASE}/self-host`,
  },
  {
    id: 'usage-limits',
    area: 'usage / limits / tiers / billing',
    keywords: [
      'usage', 'limit', 'limits', 'rate', 'quota', 'tier', 'billing', 'plan',
      'mau', 'cap', 'overage', 'price', 'cost',
    ],
    howBrivenWorksHere:
      'projects run on tiers with caps (storage bytes, MAU for auth, rate limits on ' +
      'hot paths). usage is surfaced in the dashboard; overage billing is metered.',
    whatOurToolsGiveYou: [
      'MCP storage_usage for live storage numbers; dashboard auth → usage for MAU + email delivery.',
      'bulk write paths (insert with a values array) exist specifically to stay under per-minute rate limits.',
    ],
    whatYouBuildInYourProject: [
      'batch your writes; back off on 429s with retry-after.',
      'if a legitimate workload keeps hitting a cap, that is an owner conversation (tier change), not a workaround.',
    ],
    docs: `${DOCS_BASE}/status`,
  },
  {
    id: 'migration',
    area: 'migrating from another backend',
    keywords: [
      'migrate', 'migration', 'convex', 'supabase', 'firebase', 'prisma', 'drizzle',
      'mongodb', 'hasura', 'nextauth', 'move', 'import', 'port',
    ],
    howBrivenWorksHere:
      'documented per-source playbooks (convex, supabase, raw postgres, drizzle, prisma, ' +
      'firebase, mongodb, hasura, nextauth) built on five principles: read before write, ' +
      'parallel-run, back up twice, schema-first, one product at a time.',
    whatOurToolsGiveYou: [
      'docs /migration + a per-source page each with the concrete mapping table.',
      'MCP create_table/insert for scripted imports (mind rate limits — batch!).',
    ],
    whatYouBuildInYourProject: [
      'the export from your old backend and the transform script are yours; run them against a THROWAWAY briven project first, verify counts, then do production.',
      'keep the old backend readable until parallel-run proves the new one.',
    ],
    docs: `${DOCS_BASE}/migration`,
  },
  {
    id: 'versioning-undo',
    area: 'undo / snapshots / data history',
    keywords: [
      'undo', 'snapshot', 'history', 'restore', 'rollback', 'version', 'branch',
      'time', 'travel', 'diff', 'backup', 'recover',
    ],
    howBrivenWorksHere:
      'the database is git-for-data: every change is committed, so you get log, diff, ' +
      'tags, branches, and reset — data history is a first-class feature, not a backup afterthought.',
    whatOurToolsGiveYou: [
      'SQL surface: dolt_log, dolt_diff, DOLT_COMMIT/TAG/RESET/BRANCH via the query tool.',
      'docs /undo explains both the plain-language and the SQL versions.',
    ],
    whatYouBuildInYourProject: [
      'tag (DOLT_TAG) before risky migrations from your own scripts so rollback is one statement.',
      'user-facing "undo" in your app: read the history tables and surface the diff — the primitives are all queryable.',
    ],
    docs: `${DOCS_BASE}/undo`,
  },
] as const;

/* ── docs index (mirror of apps/docs corpus slugs — cite, don't drift) ── */

export const DOCS_INDEX: readonly { slug: string; title: string }[] = [
  { slug: '/', title: 'overview' },
  { slug: '/quickstart', title: 'quickstart' },
  { slug: '/schema', title: 'schema dsl reference' },
  { slug: '/functions', title: 'functions reference' },
  { slug: '/realtime', title: 'realtime — reactive queries' },
  { slug: '/sdks', title: 'sdk reference' },
  { slug: '/api', title: 'http api reference' },
  { slug: '/auth', title: 'auth + email sender domain + verifiable tokens (jwt/jwks)' },
  { slug: '/cli', title: 'cli reference' },
  { slug: '/undo', title: 'undo + snapshots' },
  { slug: '/vector-search', title: 'vector search' },
  { slug: '/ai', title: 'ai features' },
  { slug: '/self-host', title: 'self-host' },
  { slug: '/migration', title: 'migration playbooks' },
  { slug: '/templates', title: 'project templates' },
  { slug: '/examples', title: 'examples gallery' },
  { slug: '/status', title: 'status + limits' },
  { slug: '/support', title: 'support' },
  { slug: '/changelog', title: 'changelog' },
] as const;

/* ── matcher ─────────────────────────────────────────────────────────── */

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Score guides by keyword/area overlap. Exported for tests. */
export function matchBrivenGuides(question: string, limit = 2): BrivenAreaGuide[] {
  const tokens = new Set(tokenise(question));
  return BRIVEN_AREA_GUIDES.map((g) => {
    let score = 0;
    for (const k of g.keywords) if (tokens.has(k)) score += 2;
    for (const t of tokenise(g.area)) if (tokens.has(t)) score += 1;
    return { g, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.g);
}

/* ── self-growing knowledge base (cache + grounding) ─────────────────── */

// Common English filler stripped so paraphrases of the same wall collapse to
// one cache key. Kept small on purpose — over-stripping would merge distinct
// questions.
const TOPIC_STOPWORDS = new Set([
  'the', 'a', 'an', 'how', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
  'is', 'are', 'was', 'to', 'from', 'with', 'in', 'on', 'of', 'for', 'and', 'or',
  'my', 'me', 'i', 'you', 'your', 'it', 'this', 'that', 'these', 'those', 'using',
  'use', 'when', 'what', 'where', 'why', 'get', 'need', 'want', 'please', 'help',
  'briven', 'project',
]);

/**
 * Normalise a question into a stable topic key: de-duplicated, filler-stripped,
 * sorted content words. "How do I read my tables from a Python app?" and
 * "reading tables in python app" collapse to the same key. Exported for tests.
 */
export function topicKey(question: string): string {
  const content = Array.from(
    new Set(tokenise(question).filter((t) => !TOPIC_STOPWORDS.has(t))),
  ).sort();
  if (content.length > 0) return content.join('-').slice(0, 200);
  // Degenerate case (question was all filler): fall back to raw sorted tokens.
  const all = Array.from(new Set(tokenise(question))).sort();
  if (all.length > 0) return all.join('-').slice(0, 200);
  // Last resort (no multi-char word tokens at all, e.g. "I a b"): compact the
  // raw alphanumerics so we still get a deterministic key. Returns '' only for
  // a question with no letters/digits whatsoever — callers must treat an empty
  // key as "do not cache" (an empty key would collide across unrelated inputs).
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

// The ONLY knowledge the grounded writer may draw on: briven's own curated
// guides + docs index. Built once (module-lifetime) — the guides are static.
let _grounding: string | null = null;
function buildGrounding(): string {
  if (_grounding) return _grounding;
  const guideText = BRIVEN_AREA_GUIDES.map(
    (g) =>
      `AREA: ${g.area}\nHOW BRIVEN WORKS HERE: ${g.howBrivenWorksHere}\n` +
      `WHAT OUR TOOLS GIVE YOU:\n- ${g.whatOurToolsGiveYou.join('\n- ')}\n` +
      `WHAT YOU BUILD IN YOUR PROJECT:\n- ${g.whatYouBuildInYourProject.join('\n- ')}\n` +
      `DOCS: ${g.docs}`,
  ).join('\n\n');
  const docsText =
    'DOCS INDEX:\n' + DOCS_INDEX.map((d) => `- ${d.title}: ${DOCS_BASE}${d.slug}`).join('\n');
  _grounding = `${guideText}\n\n${docsText}`;
  return _grounding;
}

/**
 * Serve a previously-remembered answer for this topic key, bumping its
 * hit-count. Fail-soft: any DB error returns null so the desk stays up and
 * simply falls through to the writer / filed path.
 */
async function serveCachedAnswer(
  key: string,
): Promise<{ answer: GroundedAnswer; source: string } | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(mcpKnownAnswers)
    .where(eq(mcpKnownAnswers.topicKey, key))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  // Validate the STORED shape too — a hand-seeded or drifted row must never be
  // served blank. If it fails the same substance guard the writer output must
  // pass, treat it as a miss so the desk falls through to the writer/filed path.
  const answer = validateStoredAnswer(row.answer);
  if (!answer) return null;
  await db
    .update(mcpKnownAnswers)
    .set({ hitCount: sql`${mcpKnownAnswers.hitCount} + 1`, updatedAt: new Date() })
    .where(eq(mcpKnownAnswers.id, row.id));
  return { answer, source: row.source };
}

/**
 * Defensive scrub of the representative question before it lands in the shared
 * (admin-readable) cache table: strip anything that looks like a briven key or
 * a long opaque token, so a careless question can't park a secret here.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(pk_[a-z]+_|brk_|mck_|sk_)[A-Za-z0-9._-]{6,}/gi, '$1[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._-]{6,}/gi, 'bearer [redacted]')
    .replace(/\b[A-Za-z0-9._-]{40,}\b/g, '[redacted]');
}

/**
 * Remember a freshly-composed answer so the next agent gets it instantly.
 * `onConflictDoNothing` on the unique topic key makes concurrent writers safe.
 */
async function storeAnswer(
  key: string,
  question: string,
  answer: GroundedAnswer,
  model: string,
): Promise<void> {
  const db = getDb();
  await db
    .insert(mcpKnownAnswers)
    .values({
      id: newId('kans'),
      topicKey: key,
      question: redactSecrets(question).slice(0, 300),
      answer,
      source: 'auto',
      model,
      hitCount: 1,
    })
    .onConflictDoNothing({ target: mcpKnownAnswers.topicKey });
}

/* ── registration ────────────────────────────────────────────────────── */

export function registerBrivenAskTool(
  server: McpServer,
  _ctx: { projectId: string },
  auditCall: (tool: string, metadata: Record<string, unknown>) => Promise<void>,
  jsonResult: (payload: unknown) => { content: { type: 'text'; text: string }[] },
): void {
  server.registerTool(
    'briven_ask',
    {
      title: 'Ask briven (any topic — guidance)',
      description:
        'Ask ANY question about building on briven: database, storage, functions, ' +
        'realtime, auth, keys, limits, migration, versioning, hosting. Every answer ' +
        'follows a three-part contract: how briven works in that area, what our tools ' +
        'give you today, and what you build in YOUR project to close the gap — plus ' +
        'docs citations. Questions with no curated match are filed for the platform ' +
        'team AND still receive best-effort guidance; a question is never a dead end.',
      inputSchema: {
        question: z.string().min(3).max(600).describe('Your question in plain words'),
      },
      // Not strictly read-only: an unmatched question may memoise a grounded
      // answer into the platform-wide known-answers cache (never any project's
      // own data). Honest hint so hosts that gate on it aren't misled.
      annotations: { readOnlyHint: false },
    },
    async ({ question }) => {
      const guides = matchBrivenGuides(question);
      const filedForReview = guides.length === 0;
      // The question text is stored (truncated) ONLY when unmatched, so a
      // briven session can review the inbox and extend the guides. Matched
      // questions log length only.
      await auditCall('briven_ask', {
        matched: guides.map((g) => g.id),
        filedForReview,
        ...(filedForReview ? { question: question.slice(0, 300) } : { length: question.length }),
      });

      if (filedForReview) {
        // Self-growing desk: before the honest "filed" reply, (1) serve a
        // previously-remembered answer for this same wall, else (2) compose one
        // grounded ONLY in briven's own docs and remember it. Both steps are
        // fail-soft + dormant-safe — a DB error or the model engine being off
        // just falls through to the unchanged filed response below, so the desk
        // never hangs or errors. The cache write touches briven's control-plane
        // only (never the caller's project data), so this stays read-only from
        // the agent's perspective.
        // Only use the shared cache with a stable, non-empty key. An empty key
        // (a question with no letters or digits at all) would collide across
        // unrelated inputs, so such questions skip caching entirely.
        const key = topicKey(question);

        if (key) {
          const cached = await serveCachedAnswer(key).catch((err) => {
            log.warn('briven_ask_cache_read_failed', {
              message: err instanceof Error ? err.message : String(err),
            });
            return null;
          });
          if (cached) {
            return jsonResult({
              answered: true,
              filedForReview: false,
              source: cached.source,
              guides: [cached.answer],
              note:
                "served from briven's known-answers desk (a question resolved earlier). " +
                'for live project state use the data/storage/auth tools on this same connection.',
            });
          }
        }

        const written = await writeGroundedAnswer({
          question,
          grounding: buildGrounding(),
        }).catch(() => ({ grounded: false as const }));
        if (written.grounded) {
          if (key) {
            await storeAnswer(key, question, written.answer, written.model).catch((err) => {
              log.warn('briven_ask_cache_write_failed', {
                message: err instanceof Error ? err.message : String(err),
              });
            });
          }
          return jsonResult({
            answered: true,
            filedForReview: false,
            source: 'auto',
            guides: [written.answer],
            note:
              "composed from briven's own docs for a question no curated guide matched, " +
              'and remembered for the next agent. build within these tools — never a side ' +
              'database, a raw sql login, or a special-feature request; a genuine gap is ' +
              'filed via this desk.',
          });
        }

        return jsonResult({
          answered: false,
          filedForReview: true,
          message:
            'no curated guide matched this question yet — it has been FILED for the ' +
            'platform team, and the guides get extended from exactly these filings. ' +
            'you are not at a dead end: use the best-effort orientation below, and ' +
            're-ask after the next platform update.',
          bestEffort: {
            howBrivenWorksHere:
              'briven is a reactive postgres backend platform: per-project isolated ' +
              'database (with git-for-data versioning), file storage, server functions, ' +
              'realtime queries, managed end-user auth, and this MCP — all scoped to ' +
              'your project by your key.',
            whatOurToolsGiveYou: [
              'this MCP: data tools (list_tables/describe_table/query + writes), storage tools, auth tools (auth_config_get / sender_domain_status / auth_docs_ask).',
              'the docs cover every area — see docsIndex below for the map.',
            ],
            whatYouBuildInYourProject: [
              'if the capability is not in the docs map, briven likely does not provide it directly — build it in your app on top of the primitives (tables + functions + storage cover most gaps).',
              'if you believe it SHOULD be a platform feature, say so to the project owner — filed questions drive the roadmap.',
            ],
          },
          docsIndex: DOCS_INDEX.map((d) => ({ title: d.title, url: `${DOCS_BASE}${d.slug}` })),
        });
      }

      return jsonResult({
        answered: true,
        filedForReview: false,
        guides: guides.map((g) => ({
          area: g.area,
          howBrivenWorksHere: g.howBrivenWorksHere,
          whatOurToolsGiveYou: g.whatOurToolsGiveYou,
          whatYouBuildInYourProject: g.whatYouBuildInYourProject,
          docs: g.docs,
        })),
        note:
          'contract: platform picture → available primitives → your-side work. for ' +
          'live project state use the data/storage/auth tools on this same connection. ' +
          'full docs map: ' + DOCS_BASE,
      });
    },
  );
}

/** Tool names this module registers — kept in lock-step with READ_TOOLS. */
export const BRIVEN_ASK_TOOLS = ['briven_ask'] as const;
