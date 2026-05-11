import { DocsShell } from '../../components/shell';

export const metadata = {
  title: 'changelog',
};

interface Entry {
  date: string; // ISO yyyy-mm-dd
  tags: readonly Tag[];
  title: string;
  body: string;
}

type Tag = 'feat' | 'fix' | 'security' | 'docs' | 'infra' | 'chore';

const ENTRIES: readonly Entry[] = [
  {
    date: '2026-05-11',
    tags: ['docs'],
    title: 'migration guide: hasura → briven',
    body: 'fifth per-source migration page. postgres half ports for free via pg_dump; the work is the permissions port — every (role, table, action) triple from hasura metadata becomes a guard in function code. covers actions, event triggers, scheduled triggers, remote schemas, auth (preserve-ids vs preserve-jwts) and subscriptions vs briven\'s reactive useQuery.',
  },
  {
    date: '2026-05-11',
    tags: ['feat'],
    title: 'deploy_history table + /dashboard/admin/deploys',
    body: 'every api boot now writes one row into deploy_history (service, buildSha, buildAt, env, bootedAt). new admin page renders a timeline with "live" badge on the most recent row so operators can correlate "the bug appeared at 14:32" with "deploy abc1234 went live at 14:30" without ssh-ing to the box. /v1/admin/deploys?service=api&limit=N exposes the raw stream.',
  },
  {
    date: '2026-05-11',
    tags: ['fix'],
    title: '/info reports a real sha on dokploy auto-deploys',
    body: 'health.ts now resolves the commit sha from .git/HEAD when BRIVEN_BUILD_SHA isn\'t passed at image build time (which is exactly the case for dokploy auto-deploys). loose refs + packed-refs both supported. paired with treating the literal "dev" string as a "fall back to git" sentinel since that\'s the dockerfile ARG default.',
  },
  {
    date: '2026-05-11',
    tags: ['infra'],
    title: 'observability stack live + postgres-exporter sidecar',
    body: 'grafana / loki / prometheus / promtail running on briven.tech kvm4 as compose project briven-obs; postgres-exporter ships pg_stat_* metrics from briven-postgres. all five prometheus jobs (api / runtime / realtime / postgres / prometheus) report up; four starter dashboards (api requests, runtime invocations, realtime subs, postgres health) populated.',
  },
  {
    date: '2026-05-11',
    tags: ['feat'],
    title: 'mittera email suppression layer',
    body: 'new email_suppressions table + service. mittera webhook handler dispatches permanent bounces / complaints / mittera-suppressed events into the suppression list; outbound send short-circuits on suppressed recipients before posting to mittera. admin ui at /dashboard/admin/email-suppressions with manual add / remove.',
  },
  {
    date: '2026-05-11',
    tags: ['feat'],
    title: 'mittera outbound + webhook live on briven.tech',
    body: 'POST https://api.mittera.eu/api/v1/emails with Bearer auth verified end-to-end (smoke + magic-link both 200). inbound webhooks at https://api.briven.tech/mittera-webhook verify X-mittera-Signature: v1=<hex> + X-mittera-Timestamp: <ms> with a 5-minute replay window, dispatch per spec §6, audit-log every event.',
  },
  {
    date: '2026-05-11',
    tags: ['feat'],
    title: 'nightly backup cron on kvm4',
    body: 'systemd timer fires /usr/local/bin/briven-backup.sh daily at 02:17 UTC. pg_dump --format=custom against briven-postgres for both briven_control + briven_data, 30-day local retention, off-site upload gated on /etc/briven/backup.env (BRIVEN_BACKUP_S3_*). off-site disabled until B2/R2 creds land.',
  },
  {
    date: '2026-05-11',
    tags: ['feat'],
    title: 'briven init --template={blank,todo-app,chat}',
    body: 'cli init now scaffolds from one of three inline templates. blank = minimal notes; todo-app = 4 mutations + 1 reactive query; chat = two-table per-room reactive. templates are embedded so init works on a fresh machine with no network.',
  },
  {
    date: '2026-05-11',
    tags: ['feat'],
    title: 'briven doctor + GET /info build identity',
    body: 'doctor now pings /info (new endpoint) and reports build sha + build timestamp + uptime alongside the existing health / ready / auth checks. Dockerfile passes BRIVEN_BUILD_SHA + BRIVEN_BUILD_AT through as ARGs for compose to inject.',
  },
  {
    date: '2026-05-11',
    tags: ['feat'],
    title: 'admin: email events + suppressions dashboards',
    body: 'two new pages under /dashboard/admin — email-events (last 200 webhook deliveries with severity-tinted chips) and email-suppressions (recipients we won\'t send to, with manual add / remove). both gated on is_admin.',
  },
  {
    date: '2026-05-11',
    tags: ['infra'],
    title: 'forgejo actions ci',
    body: '.forgejo/workflows/ci.yml runs pnpm -r lint + typecheck + test on every push to main. real eslint config replaces 13 lint stubs; 15 packages green workspace-wide.',
  },
  {
    date: '2026-05-11',
    tags: ['chore'],
    title: 'briven.cloud → briven.tech sweep (78 files)',
    body: 'every public-facing reference to the placeholder briven.cloud domain replaced with briven.tech. scripts/swap-domain.sh ships as the rename helper for future cutovers.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: '@briven/svelte + @briven/vue clients',
    body: 'svelte stores (query / mutation, reference-counted by svelte\'s store contract) and vue 3 composables (useQuery / useMutation, onScopeDispose-cleaned). same shape as the react hooks; same setBrivenClient bootstrap.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'briven export / briven import',
    body: 'briven export writes a project\'s schema + functions to a json archive; briven import reads the archive back into a target project as a deployment. data movement (pg_dump streaming) follows in a later slice.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'briven projects (list + set-default)',
    body: 'list projects authenticated on this machine; set the local default that other commands fall back to when there\'s no briven.json. zero server round-trip — works against the per-project api keys the cli already stores.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'studio (read mode)',
    body: 'embedded data browser at /dashboard/projects/:id/studio. table list with approx row counts and storage size; per-table view with column metadata and paginated rows. admin-tier gated; identifier escaping prevents cross-schema reads.',
  },
  {
    date: '2026-05-10',
    tags: ['infra'],
    title: 'observability stack + metrics endpoints',
    body: 'grafana / loki / prometheus / promtail compose ships under infra/observability with four starter dashboards (api requests, runtime invocations, realtime subs, postgres health). /metrics now live on api + realtime; postgres-exporter sidecar template ready for the data plane.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'restore drill (monthly cron)',
    body: 'pulls the latest pg_dump off off-site storage, sha256-verifies, restores into a throwaway db, sanity-counts core tables, drops the db. systemd timer on the 1st at 04:30 UTC. non-zero exit fires the discord webhook.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'public status page',
    body: 'docs.briven.tech/status — live probes against api / runtime / realtime, red/green per service, latency + http status, no cache. dns cutover to status.briven.tech is a future ops move.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'open-signups env flag',
    body: 'BRIVEN_OPEN_SIGNUPS toggles invite-only beta vs. public signups across all three Better Auth paths (email+password, github oauth, magic link). cutover is now config-only, no code change.',
  },
  {
    date: '2026-05-10',
    tags: ['docs'],
    title: 'sla matrix on /dashboard/billing',
    body: 'uptime, response target, support response, rollback window — per tier. free best-effort; pro 99.5% / p99 < 500ms invoke; team 99.9% / p99 < 200ms invoke + 100ms RT fan-out.',
  },
  {
    date: '2026-05-10',
    tags: ['chore'],
    title: 'metrics module promoted to @briven/shared',
    body: 'createMetricsRegistry({help}) factory in @briven/shared/observability replaces three duplicated hand-rolled prometheus exposition modules in api / runtime / realtime. each app instantiates its own scoped registry; ~400 LOC of duplication retired.',
  },
  {
    date: '2026-05-10',
    tags: ['feat', 'docs'],
    title: 'public migration guide + public changelog',
    body: 'docs.briven.tech/migration documents the five principles + ten-step playbook that every briven migration follows, with per-source teasers for convex / supabase / raw-postgres / firebase. this changelog ships alongside.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'phase 3 abuse-report pipeline',
    body: 'public POST /v1/abuse-reports (anonymous, rate-limited 5/min/IP via cf-connecting-ip) + admin GET/PATCH /v1/admin/abuse-reports for triage. severity (spam / phishing / malware / csam / tos / other) and resolution (no_action / warned / suspended / banned) frozen.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'phase 3 beta-invite dashboard surface',
    body: 'recipients can now see and accept pending invitations from /dashboard/invitations without going through the email link. the email-link flow stays intact for not-yet-signed-in recipients. accept-by-id replaces the token-based path inside the dashboard so the listing API never has to expose one-time tokens.',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'phase 3 usage-metering (invocations slice)',
    body: 'GET /v1/projects/:id/usage returns invocation count + total duration for the current calendar month UTC, with optional ?from=&until= for custom windows. backed by aggregation over function_logs (no new event table needed for this slice).',
  },
  {
    date: '2026-05-10',
    tags: ['feat'],
    title: 'tier-aware rate limits at the gateway',
    body: 'rateLimit middleware now accepts a dynamic limit fn so caps can vary per project tier. RATE_LIMITS_BY_TIER table: invoke = 60 / 600 / 6000 per minute (free / pro / team), deploy = 5 / 30 / 100. wired onto the invoke and deploy routes; rollout to remaining mutations is the next pull.',
  },
  {
    date: '2026-05-10',
    tags: ['feat', 'fix'],
    title: 'briven invoke command',
    body: 'briven invoke <function> [--body <json>] [--body-file <path>] [--raw] is in the CLI. closes the dogfood smoke-test gap that previously required curl. --raw mode prints the unwrapped function value, jq-pipeable.',
  },
  {
    date: '2026-05-09',
    tags: ['feat'],
    title: 'shared structured logger with redaction',
    body: '@briven/shared/observability exports createLogger(). every emitted line runs through the redaction pass — emails and IPv4 addresses can\'t leak into Loki even if a caller forgets to scrub at the call site. apps/api, apps/runtime, apps/realtime all delegate.',
  },
  {
    date: '2026-05-09',
    tags: ['security'],
    title: 'constant-time shared-secret comparison',
    body: 'the runtime shared secret is now compared with crypto.timingSafeEqual across apps/api/src/routes/internal.ts, apps/runtime/src/index.ts, and apps/realtime/src/index.ts. a remote attacker measuring response latency can no longer recover the secret byte-by-byte.',
  },
  {
    date: '2026-05-09',
    tags: ['security'],
    title: 'rate-limit pinned to cf-connecting-ip outside dev',
    body: 'rate-limit middleware now returns 403 origin_direct_rejected when BRIVEN_ENV !== development and cf-connecting-ip is missing. prevents bypass via direct origin hits (cloudflare-only ingress in production).',
  },
  {
    date: '2026-05-09',
    tags: ['security'],
    title: 'BRIVEN_ENCRYPTION_KEY required at boot in non-dev',
    body: 'previously failed-closed at request time when missing — a deploy could boot, only blowing up when the first customer read an encrypted env var. now fails loud at startup.',
  },
  {
    date: '2026-05-09',
    tags: ['feat'],
    title: 'realtime LISTEN/NOTIFY pipeline complete',
    body: 'apps/realtime now closes the loop: WS subscribe → LISTEN on per-table channels → NOTIFY → re-invoke → push fresh data. internal invoke route added on apps/api so realtime can use the runtime shared secret. fireChannel snapshot iteration prevents touchedTables drift from skipping subscribers mid-fan-out.',
  },
  {
    date: '2026-04-27',
    tags: ['security'],
    title: 'owner-tier scaffolding pinned (PR #20)',
    body: 'reservation for future destructive routes (project delete, member removal). enforced via the project-auth chain.',
  },
  {
    date: '2026-04-27',
    tags: ['security'],
    title: 'per-key role scoping for API keys (PR #19)',
    body: 'human users can issue keys at their own role or lower (viewer / developer / admin). owner-tier is reserved for human owners and never assignable to a key.',
  },
  {
    date: '2026-04-26',
    tags: ['security'],
    title: 'HTTPS-origin invariant fail-fast outside dev (PR #18)',
    body: 'BRIVEN_API_ORIGIN and BRIVEN_WEB_ORIGIN must start with https:// when BRIVEN_ENV !== development. catches misconfigured prod deploys at boot.',
  },
  {
    date: '2026-04-26',
    tags: ['fix'],
    title: 'realtime + runtime smoke tests (PR #17)',
    body: 'bun-test smoke files so CI exits 0 with empty suites. closed the noise from CI runs that warned "no tests found".',
  },
  {
    date: '2026-04-25',
    tags: ['security'],
    title: 'org-vs-project authz reconciliation (PR #16)',
    body: 'effective-role gates resolve project-level role from org membership when the project doesn\'t carry an explicit member row. fixes a class of bugs where org owners couldn\'t access their own projects.',
  },
  {
    date: '2026-04-25',
    tags: ['security'],
    title: 'cross-site CSRF closed on /v1/* state-changing routes (PR #15)',
    body: 'sameSite=strict on the session cookie + Origin-check middleware. unsafe-method requests with a session cookie now require an allow-listed Origin.',
  },
  {
    date: '2026-04-25',
    tags: ['security'],
    title: 'schemaSnapshot validator + bound migration insert (PR #14)',
    body: 'closed a high-severity SQL-injection vector — the schema snapshot is now strictly validated before any DDL is interpolated.',
  },
  {
    date: '2026-04-25',
    tags: ['security'],
    title: 'security hardening phase-0 (PR #13)',
    body: 'better-auth secret rotation, audit-log IP pepper, IP redaction in logs, realtime WebSocket upgrade gate.',
  },
  {
    date: '2026-04-24',
    tags: ['feat'],
    title: '@briven/cli ships as a self-contained tarball (PR #10)',
    body: 'tsup bundles the cli with @briven/schema, @briven/shared, @briven/config inlined. consumers install via pnpm add -D @briven/cli without the workspace-ref problem the prior file: install hit. exposes @briven/cli/schema and @briven/cli/server sub-imports.',
  },
  {
    date: '2026-04-24',
    tags: ['feat'],
    title: 'briven link writes projectId into briven.json (PR #11)',
    body: 'briven link --project <p_…> records the project id locally so subsequent commands (deploy, invoke, env, db) infer it without --project flags.',
  },
  {
    date: '2026-04-24',
    tags: ['infra'],
    title: 'wildcard TLS via Cloudflare DNS-01 (PR #9)',
    body: 'traefik issues *.apps.briven.tech certificates via the cloudflare DNS challenge. each customer project gets its own routable subdomain at deploy time.',
  },
  {
    date: '2026-04-23',
    tags: ['fix'],
    title: 'auto-create personal org on signup + lazy backfill (PR #12)',
    body: 'every user has exactly one personal org from the moment they sign in. /v1/me lazily backfills for older users who pre-date the change.',
  },
];

const TAG_STYLE: Record<Tag, string> = {
  feat: 'bg-[var(--color-primary)] text-[var(--color-text-inverse)]',
  fix: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
  security: 'bg-[var(--color-text-error)] text-[var(--color-text-inverse)]',
  docs: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
  infra: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
  chore: 'border border-[var(--color-border)] text-[var(--color-text-subtle)]',
};

export default function ChangelogPage() {
  const grouped = groupByMonth(ENTRIES);
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">changelog</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        what landed, in reverse chronological order. one entry per shipped change worth
        knowing about — security, features, infrastructure, fixes.
      </p>

      <div className="mt-6 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 font-mono text-xs text-[var(--color-text-muted)]">
        briven is in dogfood-first development through 2026. external signups open with the
        public beta in <strong>oct 2026</strong>; everything before that is internal validation
        on j&apos;s own products.
      </div>

      <div className="mt-12 flex flex-col gap-12">
        {grouped.map(({ month, entries }) => (
          <section key={month}>
            <h2 className="font-mono text-xl tracking-tight">{month}</h2>
            <ul className="mt-6 flex flex-col gap-6">
              {entries.map((entry) => (
                <li key={`${entry.date}-${entry.title}`} className="flex flex-col gap-2">
                  <div className="flex items-center gap-3">
                    <time className="font-mono text-xs text-[var(--color-text-subtle)]">
                      {entry.date}
                    </time>
                    <div className="flex gap-1">
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TAG_STYLE[tag]}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="font-mono text-sm">{entry.title}</p>
                  <p className="font-mono text-sm text-[var(--color-text-muted)]">{entry.body}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </DocsShell>
  );
}

function groupByMonth(entries: readonly Entry[]): { month: string; entries: Entry[] }[] {
  const buckets = new Map<string, Entry[]>();
  for (const entry of entries) {
    const month = entry.date.slice(0, 7); // yyyy-mm
    const list = buckets.get(month) ?? [];
    list.push(entry);
    buckets.set(month, list);
  }
  // Sort entries within each bucket newest-first, then sort buckets newest-first.
  for (const list of buckets.values()) {
    list.sort((a, b) => b.date.localeCompare(a.date));
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, list]) => ({ month: formatMonth(month), entries: list }));
}

function formatMonth(yyyymm: string): string {
  const [yearStr, monthStr] = yyyymm.split('-');
  const year = Number(yearStr);
  const monthIdx = Number(monthStr) - 1;
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  return `${monthNames[monthIdx] ?? yyyymm} ${year}`;
}
