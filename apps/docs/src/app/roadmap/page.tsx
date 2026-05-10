import { DocsShell } from '../../components/shell';

export const metadata = { title: 'roadmap' };

export default function RoadmapPage() {
  return (
    <DocsShell>
      <h1 className="font-mono text-2xl tracking-tight">roadmap</h1>
      <p className="mt-2 font-mono text-sm text-[var(--color-text-muted)]">
        what we&apos;re building, in rough order of priority. dates are intent, not commitment —
        anything ships when it&apos;s ready and not before. the changelog is what actually
        landed; this page is what we&apos;re working towards.
      </p>

      <Phase label="now" body="dogfooding briven on a single VPS, hardening the operator surface, public alpha behind invite codes.">
        <Bullet status="done">phase 0 — foundations: api, runtime, realtime, dashboard, docs all live</Bullet>
        <Bullet status="done">phase 1 — reactive queries via LISTEN/NOTIFY across all client SDKs</Bullet>
        <Bullet status="done">phase 2 — per-tier rate limits, abuse pipeline, audit log, encryption-at-rest for env vars</Bullet>
        <Bullet status="done">phase 3 — usage metering, beta invite UX, studio CRUD UI, admin triage</Bullet>
        <Bullet status="done">phase 4 — self-host templates, observability stack, public docs polish, status page</Bullet>
        <Bullet status="active">deploy on briven&apos;s own VPS, run alpha invitees through the cli + dashboard</Bullet>
      </Phase>

      <Phase label="next" body="closing the gaps that turn alpha into a product anyone can adopt without hand-holding.">
        <Bullet status="planned">point-in-time recovery (replace nightly pg_dump with WAL streaming + 7-day window)</Bullet>
        <Bullet status="planned">multi-region read replicas (eu-west + us-east, opt-in per project)</Bullet>
        <Bullet status="planned">team auth: SSO via SAML/OIDC, per-project member roles beyond owner/admin/developer</Bullet>
        <Bullet status="planned">payments live: Polar + invoice PDFs + dunning + tax handling for EU/UK</Bullet>
        <Bullet status="planned">function logs: full-text search across the last 7 days (today is tail-only)</Bullet>
        <Bullet status="planned">scheduled functions: cron expressions in code, observable in the dashboard</Bullet>
        <Bullet status="planned">file uploads: presigned-URL flow + per-project minio bucket + image transforms</Bullet>
      </Phase>

      <Phase label="later" body="quality-of-life and breadth. nothing here blocks GA but we know we&apos;ll want them.">
        <Bullet status="planned">first-class python + go SDKs (parity with TS/JS clients)</Bullet>
        <Bullet status="planned">vector search beyond pgvector — first-party embedding generation via the platform</Bullet>
        <Bullet status="planned">k8s helm chart for self-hosters past ~100 projects per host</Bullet>
        <Bullet status="planned">desktop dashboard (electron) for offline-edit + git-based workflows</Bullet>
        <Bullet status="planned">briven AI: schema-aware function generator, doc-aware chatbot for self-host operators</Bullet>
      </Phase>

      <Phase label="not on the roadmap" body="things people ask about that we don&apos;t plan to build, with the why.">
        <Bullet status="rejected">
          <strong>swappable storage backend (mongo, planetscale, etc.)</strong> — the bet is on
          postgres. multi-backend is a lot of code for very little user benefit.
        </Bullet>
        <Bullet status="rejected">
          <strong>edge runtime</strong> — deno + cloudflare workers conflict on the network
          surface; we&apos;d rather invest in regional hosting on real VPSes.
        </Bullet>
        <Bullet status="rejected">
          <strong>proprietary closed-source plugins</strong> — anything we ship lives in the
          public repo, even if AGPL is incompatible with your use case (we sell exemptions).
        </Bullet>
      </Phase>

      <p className="mt-12 font-mono text-xs text-[var(--color-text-subtle)]">
        miss something? open an issue on{' '}
        <a href="https://code.konnos.org/flndrn/briven" className="underline">
          code.konnos.org/flndrn/briven
        </a>
        .
      </p>
    </DocsShell>
  );
}

function Phase({
  label,
  body,
  children,
}: {
  label: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-lg uppercase tracking-[0.12em] text-[var(--color-primary)]">
        {label}
      </h2>
      <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)]">{body}</p>
      <ul className="mt-4 space-y-2 font-mono text-sm">{children}</ul>
    </section>
  );
}

function Bullet({
  status,
  children,
}: {
  status: 'done' | 'active' | 'planned' | 'rejected';
  children: React.ReactNode;
}) {
  const tag =
    status === 'done'
      ? 'done'
      : status === 'active'
        ? 'now '
        : status === 'planned'
          ? 'next'
          : 'no  ';
  const colour =
    status === 'done'
      ? 'var(--color-text-subtle)'
      : status === 'active'
        ? 'var(--color-primary)'
        : status === 'planned'
          ? 'var(--color-text-muted)'
          : 'var(--color-text-subtle)';
  return (
    <li className="flex items-start gap-3">
      <span
        className="font-mono text-[10px] uppercase tracking-[0.12em]"
        style={{ color: colour, paddingTop: 2 }}
      >
        [{tag}]
      </span>
      <span className="text-[var(--color-text-muted)]">{children}</span>
    </li>
  );
}
